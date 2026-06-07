import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type {
	SyncLogErrorEntryDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	TriggerSyncResponseDto,
	ApiContractConfig,
	ResolvedApiContract,
} from '@nestidp/shared';
import { getByPath, resolveApiContract } from '@nestidp/shared';
import { ApiConnection } from '@prisma/client';
import { toApiConnectionDto } from '../../api-connections/mappers/api-connections.mapper';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import {
	GroupNameCollisionError,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '../../identity/identity.repository';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import { PrismaService } from '../../prisma/services/prisma.service';
import {
	assertUsersArrayWithinLimit,
	detectDuplicateUserIds,
	ExternalApiValidationError,
	mapExternalGroupRow,
	mapExternalRoleRow,
	mapExternalUserRow,
} from '../validators/external-api.validator';
import type { ExternalGroupDto, ExternalRoleDto } from '../external-api.types';
import { IdentitySyncClientService } from './identity-sync-client.service';
import { IdentitySyncHttpError } from '../identity-sync.errors';
import { OAuthTokenError, OAuthTokenService } from './oauth-token.service';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { SyncLogService } from './sync-log.service';
import {
	DRY_RUN_SUMMARY_MESSAGE,
	DRY_RUN_SUMMARY_PHASE,
	toSyncLogDto,
	toSyncStatusResponseDto,
} from '../mappers/sync.mapper';

/** Thrown to abort the whole run when onRowError='fail'. */
class StrictRowError extends Error {}

interface ProcessedUser {
	externalUserId: string;
	rawRow: unknown;
	localUserId: string | null;
}

interface MembershipRaw {
	externalUserId: string;
	groupsRaw?: unknown[];
	rolesRaw?: unknown[];
	groupsError?: unknown;
	rolesError?: unknown;
}

@Injectable()
export class SyncService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly identityRepository: ActiveIdentityStore,
		private readonly syncLogService: SyncLogService,
		private readonly identitySyncClient: IdentitySyncClientService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: AuditPersistenceService,
		private readonly oauthTokenService: OAuthTokenService,
	) {}

	async triggerSync(
		connectionId: string,
		options?: { dryRun?: boolean; adminId?: string; adminUsername?: string },
	): Promise<TriggerSyncResponseDto> {
		const dryRun = options?.dryRun === true;
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		if (connection.isLocalDirectory) {
			throw new BadRequestException('Local directory is not syncable');
		}
		const connectionBefore = { ...connection };
		const contract = resolveApiContract(
			(connection.apiContractConfig as ApiContractConfig | null) ?? null,
		);

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
		const auditContext = {
			adminId: options?.adminId,
			adminUsername: options?.adminUsername,
		};

		try {
			let bearerToken = await this.resolveBearer(connection, errors);
			if (bearerToken == null) {
				return this.finishFailedTrigger(
					connectionId,
					connectionBefore,
					runningLog.id,
					dryRun,
					errors,
					{ usersSynced, groupsSynced, rolesSynced },
					auditContext,
				);
			}

			let usersBody: unknown[];
			try {
				let raw: unknown;
				try {
					raw = await this.identitySyncClient.fetchUsersRaw(
						connection.baseUrl,
						bearerToken,
						contract,
					);
				} catch (error) {
					// OAuth: a 401 may mean a stale cached token — refresh once and retry.
					if (
						connection.authType === 'OAUTH2_CLIENT_CREDENTIALS' &&
						error instanceof IdentitySyncHttpError &&
						error.options.statusCode === 401
					) {
						bearerToken = await this.oauthTokenService.getAccessToken(connection, {
							forceRefresh: true,
						});
						raw = await this.identitySyncClient.fetchUsersRaw(
							connection.baseUrl,
							bearerToken,
							contract,
						);
					} else {
						throw error;
					}
				}
				usersBody = assertUsersArrayWithinLimit(raw, this.identitySyncClient.getMaxUsersPerRun());
				if (detectDuplicateUserIds(usersBody, contract.userFieldMap.id)) {
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
					auditContext,
				);
			}

			const seenUserExternalIds = new Set<string>();
			const userRowsById = new Map<string, unknown>();
			for (const rawRow of usersBody) {
				const idValue = getByPath(rawRow, contract.userFieldMap.id);
				if (typeof idValue === 'string' && idValue.trim().length > 0) {
					userRowsById.set(idValue.trim(), rawRow);
				}
			}

			// --- Phase 1: map + upsert users (sequential, deterministic order) ---
			const processed: ProcessedUser[] = [];
			for (const [externalUserId, rawRow] of userRowsById) {
				seenUserExternalIds.add(externalUserId);
				let user;
				try {
					user = mapExternalUserRow(rawRow, {
						fieldMap: contract.userFieldMap,
						passwordHashAlgorithmConstant: contract.passwordHashAlgorithmConstant,
						activeMapping: contract.activeMapping,
						defaults: contract.defaults,
					});
				} catch (error) {
					errors.push({
						phase: 'parse_users',
						externalUserId,
						message:
							error instanceof ExternalApiValidationError ? error.message : 'Invalid user row',
					});
					if (contract.onRowError === 'fail') {
						throw new StrictRowError();
					}
					continue;
				}

				let localUserId: string | null = null;
				if (dryRun) {
					usersSynced += 1;
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
					} catch (error) {
						this.pushUpsertUserError(errors, user.id, error);
						continue;
					}
				}
				processed.push({ externalUserId, rawRow, localUserId });
			}

			// --- Phase 2: gather raw memberships (bounded-parallel HTTP for endpoint mode) ---
			const memberships = await this.gatherMemberships(
				connection.baseUrl,
				bearerToken,
				contract,
				processed,
			);

			// --- Phase 3: map + upsert memberships (sequential, original order) ---
			for (const processedUser of processed) {
				const m = memberships.get(processedUser.externalUserId);
				// Groups
				if (m?.groupsError) {
					this.pushFetchGroupsError(errors, processedUser.externalUserId, m.groupsError);
				} else if (m?.groupsRaw) {
					const groupIds = await this.applyMemberships(
						connectionId,
						processedUser,
						m.groupsRaw,
						contract.groupFieldMap,
						'group',
						{ dryRun, seen: seenGroupExternalIds, upserted: upsertedGroupExternalIds, errors },
						(count) => {
							groupsSynced += count;
						},
					);
					if (!dryRun && processedUser.localUserId) {
						await this.identityRepository.replaceUserGroups(processedUser.localUserId, groupIds);
					}
				}
				// Roles
				if (m?.rolesError) {
					this.pushFetchRolesError(errors, processedUser.externalUserId, m.rolesError);
				} else if (m?.rolesRaw) {
					const roleIds = await this.applyMemberships(
						connectionId,
						processedUser,
						m.rolesRaw,
						contract.roleFieldMap,
						'role',
						{ dryRun, seen: seenRoleExternalIds, upserted: upsertedRoleExternalIds, errors },
						(count) => {
							rolesSynced += count;
						},
					);
					if (!dryRun && processedUser.localUserId) {
						await this.identityRepository.replaceUserRoles(processedUser.localUserId, roleIds);
					}
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
				errors.push({ phase: DRY_RUN_SUMMARY_PHASE, message: DRY_RUN_SUMMARY_MESSAGE });
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

			this.recordSyncAudit('sync_completed', finishedLog.id, options, {
				usersSynced,
				status: 'SUCCESS',
			});
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
				auditContext,
			);
		}
	}

	/** Endpoint mode: bounded-parallel raw fetch. Embedded mode: synchronous extract. */
	private async gatherMemberships(
		baseUrl: string,
		bearerToken: string,
		contract: ResolvedApiContract,
		processed: ProcessedUser[],
	): Promise<Map<string, MembershipRaw>> {
		const result = new Map<string, MembershipRaw>();
		const groupsEmbedded = contract.membershipSource.groups.mode === 'embedded';
		const rolesEmbedded = contract.membershipSource.roles.mode === 'embedded';

		const worker = async (p: ProcessedUser): Promise<void> => {
			const entry: MembershipRaw = { externalUserId: p.externalUserId };
			// Groups
			if (groupsEmbedded) {
				entry.groupsRaw = this.extractEmbedded(
					p.rawRow,
					contract.membershipSource.groups.embeddedPath,
					contract.maxGroupsPerUser,
				);
			} else {
				try {
					entry.groupsRaw = await this.identitySyncClient.fetchGroupsRawForUser(
						baseUrl,
						bearerToken,
						p.externalUserId,
						contract,
					);
				} catch (error) {
					entry.groupsError = error;
				}
			}
			// Roles
			if (rolesEmbedded) {
				entry.rolesRaw = this.extractEmbedded(
					p.rawRow,
					contract.membershipSource.roles.embeddedPath,
					contract.maxRolesPerUser,
				);
			} else {
				try {
					entry.rolesRaw = await this.identitySyncClient.fetchRolesRawForUser(
						baseUrl,
						bearerToken,
						p.externalUserId,
						contract,
					);
				} catch (error) {
					entry.rolesError = error;
				}
			}
			result.set(p.externalUserId, entry);
		};

		if (groupsEmbedded && rolesEmbedded) {
			// No HTTP — extract inline, order irrelevant.
			for (const p of processed) {
				await worker(p);
			}
			return result;
		}

		await this.runPool(processed, this.identitySyncClient.getMembershipFetchConcurrency(), worker);
		return result;
	}

	private extractEmbedded(
		rawRow: unknown,
		embeddedPath: string | undefined,
		cap: number | null,
	): unknown[] {
		const value = embeddedPath ? getByPath(rawRow, embeddedPath) : undefined;
		const arr = Array.isArray(value) ? value : [];
		return cap != null ? arr.slice(0, cap) : arr;
	}

	private async applyMemberships(
		connectionId: string,
		processedUser: ProcessedUser,
		rawRows: unknown[],
		fieldMap: { id: string; name: string },
		entity: 'group' | 'role',
		ctx: {
			dryRun: boolean;
			seen: Set<string>;
			upserted: Set<string>;
			errors: SyncLogErrorEntryDto[];
		},
		addCount: (n: number) => void,
	): Promise<string[]> {
		const ids: string[] = [];
		for (const raw of rawRows) {
			let mapped: ExternalGroupDto | ExternalRoleDto;
			try {
				mapped =
					entity === 'group'
						? mapExternalGroupRow(raw, fieldMap)
						: mapExternalRoleRow(raw, fieldMap);
			} catch (error) {
				ctx.errors.push({
					phase: entity === 'group' ? 'upsert_group' : 'upsert_role',
					externalUserId: processedUser.externalUserId,
					message:
						error instanceof ExternalApiValidationError ? error.message : `Invalid ${entity} row`,
				});
				continue;
			}
			ctx.seen.add(mapped.id);
			if (ctx.dryRun) {
				if (!ctx.upserted.has(mapped.id)) {
					ctx.upserted.add(mapped.id);
					addCount(1);
				}
				continue;
			}
			try {
				const row =
					entity === 'group'
						? await this.identityRepository.upsertGroup(connectionId, mapped)
						: await this.identityRepository.upsertRole(connectionId, mapped);
				if (!ctx.upserted.has(mapped.id)) {
					ctx.upserted.add(mapped.id);
					addCount(1);
				}
				ids.push(row.id);
			} catch (error) {
				if (entity === 'group') {
					this.pushUpsertGroupError(ctx.errors, processedUser.externalUserId, mapped.id, error);
				} else {
					this.pushUpsertRoleError(ctx.errors, processedUser.externalUserId, mapped.id, error);
				}
			}
		}
		return ids;
	}

	/** Run `worker` over items with at most `concurrency` in flight. */
	private async runPool<T>(
		items: T[],
		concurrency: number,
		worker: (item: T) => Promise<void>,
	): Promise<void> {
		let index = 0;
		const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (index < items.length) {
				const current = items[index];
				index += 1;
				await worker(current);
			}
		});
		await Promise.all(runners);
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

	/** Resolve the effective Bearer value per auth type (static token or OAuth access token). */
	private async resolveBearer(
		connection: ApiConnection,
		errors: SyncLogErrorEntryDto[],
	): Promise<string | null> {
		if (connection.authType === 'OAUTH2_CLIENT_CREDENTIALS') {
			try {
				return await this.oauthTokenService.getAccessToken(connection);
			} catch (error) {
				errors.push({
					phase: 'oauth',
					message:
						error instanceof OAuthTokenError ? error.message : 'OAuth token acquisition failed',
					httpStatus: error instanceof OAuthTokenError ? error.options.statusCode : undefined,
				});
				return null;
			}
		}
		return this.decryptCredentials(connection.authCredentialsEncrypted, errors);
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

	private recordSyncAudit(
		event: 'sync_completed' | 'sync_failed',
		syncLogId: string,
		options: { adminId?: string; adminUsername?: string } | undefined,
		metadata: Record<string, unknown>,
	): void {
		this.audit.recordSafe({
			category: 'sync',
			event,
			actorType: options?.adminId ? 'admin' : 'system',
			actorId: options?.adminId ?? null,
			actorLabel: options?.adminUsername ?? null,
			metadata: { syncLogId, ...metadata },
		});
	}

	private async finishFailedTrigger(
		connectionId: string,
		connectionBefore: ApiConnection,
		logId: string,
		dryRun: boolean,
		errors: SyncLogErrorEntryDto[],
		counters: { usersSynced: number; groupsSynced: number; rolesSynced: number },
		options?: { adminId?: string; adminUsername?: string },
	): Promise<TriggerSyncResponseDto> {
		const finishedLog = await this.syncLogService.finishLog(logId, 'FAILED', counters, errors);
		this.recordSyncAudit('sync_failed', finishedLog.id, options, {
			usersSynced: counters.usersSynced,
			status: 'FAILED',
		});
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
