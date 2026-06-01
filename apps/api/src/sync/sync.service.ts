import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	SyncLogErrorEntryDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	TriggerSyncResponseDto,
} from '@nestidp/shared';
import { ApiConnection } from '@prisma/client';
import { toApiConnectionDto } from '../api-connections/api-connections.mapper';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../encryption/credentials-encryption.port';
import {
	GroupNameCollisionError,
	IdentityRepository,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '../identity/identity.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
	assertUsersArrayWithinLimit,
	detectDuplicateUserIds,
	ExternalApiValidationError,
	parseExternalUserRow,
} from './external-api.validator';
import { IdentitySyncClientService } from './identity-sync-client.service';
import { IdentitySyncHttpError } from './identity-sync.errors';
import { SyncLogService } from './sync-log.service';
import {
	DRY_RUN_SUMMARY_MESSAGE,
	DRY_RUN_SUMMARY_PHASE,
	toSyncLogDto,
	toSyncStatusResponseDto,
} from './sync.mapper';

@Injectable()
export class SyncService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly identityRepository: IdentityRepository,
		private readonly syncLogService: SyncLogService,
		private readonly identitySyncClient: IdentitySyncClientService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
	) {}

	async triggerSync(
		connectionId: string,
		options?: { dryRun?: boolean },
	): Promise<TriggerSyncResponseDto> {
		const dryRun = options?.dryRun === true;
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		const connectionBefore = { ...connection };

		if (!dryRun) {
			await this.assertRealSyncNotInProgress(connectionId, connection);
		}

		const runningLog = await this.syncLogService.createRunningLog(connectionId);

		if (!dryRun) {
			await this.prisma.apiConnection.update({
				where: { id: connectionId },
				data: { lastSyncStatus: 'IN_PROGRESS' },
			});
		}

		const errors: SyncLogErrorEntryDto[] = [];
		let usersSynced = 0;
		let groupsSynced = 0;
		let rolesSynced = 0;
		const seenGroupExternalIds = new Set<string>();
		const seenRoleExternalIds = new Set<string>();
		const upsertedGroupExternalIds = new Set<string>();
		const upsertedRoleExternalIds = new Set<string>();

		try {
			const bearerToken = this.decryptCredentials(connection.authCredentialsEncrypted, errors);
			if (bearerToken == null) {
				return this.finishFailedTrigger(
					connectionId,
					connectionBefore,
					runningLog.id,
					dryRun,
					errors,
					{ usersSynced, groupsSynced, rolesSynced },
				);
			}

			let usersBody: unknown[];
			try {
				const raw = await this.identitySyncClient.fetchUsersRaw(connection.baseUrl, bearerToken);
				usersBody = assertUsersArrayWithinLimit(raw, this.identitySyncClient.getMaxUsersPerRun());
				if (detectDuplicateUserIds(usersBody)) {
					errors.push({
						phase: 'parse_users',
						message: 'Duplicate user ids in external API response; last row wins per id',
					});
				}
			} catch (error) {
				this.pushFetchUsersError(errors, error);
				return this.finishFailedTrigger(
					connectionId,
					connectionBefore,
					runningLog.id,
					dryRun,
					errors,
					{ usersSynced, groupsSynced, rolesSynced },
				);
			}

			const seenUserExternalIds = new Set<string>();
			const userRowsById = new Map<string, unknown>();
			for (const rawRow of usersBody) {
				if (
					typeof rawRow === 'object' &&
					rawRow !== null &&
					typeof (rawRow as { id?: unknown }).id === 'string'
				) {
					const trimmed = (rawRow as { id: string }).id.trim();
					if (trimmed.length > 0) {
						userRowsById.set(trimmed, rawRow);
					}
				}
			}

			for (const [externalUserId, rawRow] of userRowsById) {
				seenUserExternalIds.add(externalUserId);
				let user;
				try {
					user = parseExternalUserRow(rawRow);
				} catch (error) {
					errors.push({
						phase: 'parse_users',
						externalUserId,
						message:
							error instanceof ExternalApiValidationError ? error.message : 'Invalid user row',
					});
					continue;
				}

				let localUserId: string | null = null;
				let userUpserted = false;

				if (dryRun) {
					usersSynced += 1;
					userUpserted = true;
				} else {
					try {
						const row = await this.identityRepository.upsertUser(connectionId, {
							externalId: user.id,
							username: user.username,
							email: user.email ?? null,
							displayName: user.displayName ?? null,
							passwordHash: user.passwordHash,
							passwordHashAlgorithm: user.passwordHashAlgorithm,
							active: user.active,
						});
						localUserId = row.id;
						usersSynced += 1;
						userUpserted = true;
					} catch (error) {
						this.pushUpsertUserError(errors, user.id, error);
						continue;
					}
				}

				if (!userUpserted) {
					continue;
				}

				try {
					const groups = await this.identitySyncClient.fetchGroupsForUser(
						connection.baseUrl,
						bearerToken,
						externalUserId,
					);
					const groupIds: string[] = [];
					for (const group of groups) {
						seenGroupExternalIds.add(group.id);
						if (dryRun) {
							if (!upsertedGroupExternalIds.has(group.id)) {
								upsertedGroupExternalIds.add(group.id);
								groupsSynced += 1;
							}
							continue;
						}
						try {
							const row = await this.identityRepository.upsertGroup(connectionId, group);
							if (!upsertedGroupExternalIds.has(group.id)) {
								upsertedGroupExternalIds.add(group.id);
								groupsSynced += 1;
							}
							groupIds.push(row.id);
						} catch (error) {
							this.pushUpsertGroupError(errors, externalUserId, group.id, error);
						}
					}
					if (!dryRun && localUserId) {
						await this.identityRepository.replaceUserGroups(localUserId, groupIds);
					}
				} catch (error) {
					this.pushFetchGroupsError(errors, externalUserId, error);
				}

				try {
					const roles = await this.identitySyncClient.fetchRolesForUser(
						connection.baseUrl,
						bearerToken,
						externalUserId,
					);
					const roleIds: string[] = [];
					for (const role of roles) {
						seenRoleExternalIds.add(role.id);
						if (dryRun) {
							if (!upsertedRoleExternalIds.has(role.id)) {
								upsertedRoleExternalIds.add(role.id);
								rolesSynced += 1;
							}
							continue;
						}
						try {
							const row = await this.identityRepository.upsertRole(connectionId, role);
							if (!upsertedRoleExternalIds.has(role.id)) {
								upsertedRoleExternalIds.add(role.id);
								rolesSynced += 1;
							}
							roleIds.push(row.id);
						} catch (error) {
							this.pushUpsertRoleError(errors, externalUserId, role.id, error);
						}
					}
					if (!dryRun && localUserId) {
						await this.identityRepository.replaceUserRoles(localUserId, roleIds);
					}
				} catch (error) {
					this.pushFetchRolesError(errors, externalUserId, error);
				}
			}

			if (!dryRun) {
				await this.identityRepository.deactivateUsersNotInExternalIds(
					connectionId,
					seenUserExternalIds,
				);
				await this.identityRepository.deleteOrphanGroups(connectionId, seenGroupExternalIds);
				await this.identityRepository.deleteOrphanRoles(connectionId, seenRoleExternalIds);
			}

			if (dryRun) {
				errors.push({
					phase: DRY_RUN_SUMMARY_PHASE,
					message: DRY_RUN_SUMMARY_MESSAGE,
				});
			}

			const finishedLog = await this.syncLogService.finishLog(
				runningLog.id,
				'SUCCESS',
				{ usersSynced, groupsSynced, rolesSynced },
				errors.length > 0 ? errors : null,
			);

			let connectionAfter = connectionBefore;
			if (!dryRun) {
				connectionAfter = await this.prisma.apiConnection.update({
					where: { id: connectionId },
					data: {
						lastSyncAt: finishedLog.finishedAt ?? new Date(),
						lastSyncStatus: 'SUCCESS',
					},
				});
			}

			return {
				syncLog: toSyncLogDto(finishedLog),
				connection: toApiConnectionDto(connectionAfter),
			};
		} catch {
			return this.finishFailedTrigger(
				connectionId,
				connectionBefore,
				runningLog.id,
				dryRun,
				errors,
				{ usersSynced, groupsSynced, rolesSynced },
			);
		}
	}

	async getSyncStatus(connectionId: string): Promise<SyncStatusResponseDto> {
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		const latestLog = await this.syncLogService.getLatestLogForConnection(connectionId);
		const syncInProgress = await this.isRealSyncInProgress(connectionId, connection);
		return toSyncStatusResponseDto(connection, latestLog, syncInProgress);
	}

	async listSyncLogs(connectionId: string, limit: number): Promise<SyncLogListResponseDto> {
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		const logs = await this.syncLogService.listLogsForConnection(connectionId, limit);
		return {
			syncLogs: logs.map((row) => toSyncLogDto(row)),
		};
	}

	async getSyncLog(syncLogId: string): Promise<SyncLogResponseDto> {
		const log = await this.syncLogService.getLogById(syncLogId);
		if (!log) {
			throw new NotFoundException('Sync log not found');
		}
		return { syncLog: toSyncLogDto(log) };
	}

	private decryptCredentials(
		authCredentialsEncrypted: string,
		errors: SyncLogErrorEntryDto[],
	): string | null {
		try {
			return this.encryption.decrypt(authCredentialsEncrypted);
		} catch {
			errors.push({
				phase: 'decrypt_credentials',
				message: 'Stored credentials could not be decrypted',
			});
			return null;
		}
	}

	private async finishFailedTrigger(
		connectionId: string,
		connectionBefore: ApiConnection,
		logId: string,
		dryRun: boolean,
		errors: SyncLogErrorEntryDto[],
		counters: { usersSynced: number; groupsSynced: number; rolesSynced: number },
	): Promise<TriggerSyncResponseDto> {
		const finishedLog = await this.syncLogService.finishLog(logId, 'FAILED', counters, errors);
		let connectionAfter = connectionBefore;
		if (!dryRun) {
			connectionAfter = await this.prisma.apiConnection.update({
				where: { id: connectionId },
				data: { lastSyncStatus: 'FAILED' },
			});
		}
		return {
			syncLog: toSyncLogDto(finishedLog),
			connection: toApiConnectionDto(connectionAfter),
		};
	}

	private async assertRealSyncNotInProgress(
		connectionId: string,
		connection: ApiConnection,
	): Promise<void> {
		const openLog = await this.syncLogService.getOpenRunningLog(connectionId);
		if (connection.lastSyncStatus !== 'IN_PROGRESS' && openLog == null) {
			return;
		}
		if (openLog == null) {
			await this.prisma.apiConnection.update({
				where: { id: connectionId },
				data: { lastSyncStatus: 'FAILED' },
			});
			return;
		}
		if (this.isStaleRun(openLog.startedAt)) {
			await this.syncLogService.finishLog(
				openLog.id,
				'FAILED',
				{ usersSynced: 0, groupsSynced: 0, rolesSynced: 0 },
				[
					{
						phase: 'concurrency',
						message: 'Previous sync run interrupted or timed out',
					},
				],
			);
			await this.prisma.apiConnection.update({
				where: { id: connectionId },
				data: { lastSyncStatus: 'FAILED' },
			});
			return;
		}
		throw new ConflictException('Sync already in progress for this connection');
	}

	private async isRealSyncInProgress(
		connectionId: string,
		connection: ApiConnection,
	): Promise<boolean> {
		const openLog = await this.syncLogService.getOpenRunningLog(connectionId);
		if (openLog != null) {
			return !this.isStaleRun(openLog.startedAt);
		}
		return connection.lastSyncStatus === 'IN_PROGRESS';
	}

	private isStaleRun(startedAt: Date): boolean {
		const staleMinutes = this.identitySyncClient.getStaleRunMinutes();
		const ageMs = Date.now() - startedAt.getTime();
		return ageMs > staleMinutes * 60_000;
	}

	private pushFetchUsersError(errors: SyncLogErrorEntryDto[], error: unknown): void {
		if (error instanceof ExternalApiValidationError) {
			errors.push({
				phase: error.message.includes('limit') ? 'user_limit' : 'fetch_users',
				message: error.message,
			});
			return;
		}
		if (error instanceof IdentitySyncHttpError) {
			const phase: SyncLogErrorEntryDto['phase'] = error.message.includes('limit')
				? 'user_limit'
				: 'fetch_users';
			errors.push({
				phase,
				message: error.message,
				httpStatus: error.options.statusCode,
			});
			return;
		}
		errors.push({ phase: 'fetch_users', message: 'Failed to fetch users' });
	}

	private pushUpsertUserError(
		errors: SyncLogErrorEntryDto[],
		externalUserId: string,
		error: unknown,
	): void {
		if (error instanceof UsernameCollisionError) {
			errors.push({
				phase: 'upsert_user',
				externalUserId,
				message: error.message,
			});
			return;
		}
		errors.push({
			phase: 'upsert_user',
			externalUserId,
			message: 'Failed to upsert user',
		});
	}

	private pushFetchGroupsError(
		errors: SyncLogErrorEntryDto[],
		externalUserId: string,
		error: unknown,
	): void {
		errors.push({
			phase: 'fetch_groups',
			externalUserId,
			message: error instanceof IdentitySyncHttpError ? error.message : 'Failed to fetch groups',
			httpStatus: error instanceof IdentitySyncHttpError ? error.options.statusCode : undefined,
		});
	}

	private pushFetchRolesError(
		errors: SyncLogErrorEntryDto[],
		externalUserId: string,
		error: unknown,
	): void {
		errors.push({
			phase: 'fetch_roles',
			externalUserId,
			message: error instanceof IdentitySyncHttpError ? error.message : 'Failed to fetch roles',
			httpStatus: error instanceof IdentitySyncHttpError ? error.options.statusCode : undefined,
		});
	}

	private pushUpsertGroupError(
		errors: SyncLogErrorEntryDto[],
		externalUserId: string,
		externalGroupId: string,
		error: unknown,
	): void {
		errors.push({
			phase: 'upsert_group',
			externalUserId,
			externalGroupId,
			message: error instanceof GroupNameCollisionError ? error.message : 'Failed to upsert group',
		});
	}

	private pushUpsertRoleError(
		errors: SyncLogErrorEntryDto[],
		externalUserId: string,
		externalRoleId: string,
		error: unknown,
	): void {
		errors.push({
			phase: 'upsert_role',
			externalUserId,
			externalRoleId,
			message: error instanceof RoleNameCollisionError ? error.message : 'Failed to upsert role',
		});
	}
}
