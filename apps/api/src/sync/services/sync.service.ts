import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import type {
	SyncLogErrorEntryDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	SyncTriggerSource,
	TriggerSyncResponseDto,
	ApiContractConfig,
	ResolvedApiContract,
	UsernameCollisionPolicy,
	SyncAllResponseDto,
	SyncAllConnectionResultDto,
} from '@nestidp/shared';
import { getByPath, resolveApiContract } from '@nestidp/shared';
import { SyncMultiSourceConfig } from './sync-multi-source.config';
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
import type { Dispatcher } from 'undici';
import { IdentitySyncClientService } from './identity-sync-client.service';
import { IdentitySyncHttpError } from '../identity-sync.errors';
import { OAuthTokenError, OAuthTokenService } from './oauth-token.service';
import { ProxyDispatcherService } from './proxy-dispatcher.service';
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
	private readonly logger = new Logger(SyncService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly identityRepository: ActiveIdentityStore,
		private readonly syncLogService: SyncLogService,
		private readonly identitySyncClient: IdentitySyncClientService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: AuditPersistenceService,
		private readonly oauthTokenService: OAuthTokenService,
		private readonly proxyDispatcher: ProxyDispatcherService,
		private readonly multiSourceConfig: SyncMultiSourceConfig,
	) {}

	async triggerSync(
		connectionId: string,
		options?: {
			dryRun?: boolean;
			adminId?: string;
			adminUsername?: string;
			triggerSource?: SyncTriggerSource;
		},
	): Promise<TriggerSyncResponseDto> {
		const dryRun = options?.dryRun === true;
		const triggerSource: SyncTriggerSource = options?.triggerSource ?? 'manual';
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
		// Resolve the outbound proxy dispatcher once per run (sync targets share the baseUrl host).
		// `undefined` ⇒ direct connection. Same dispatcher is used for users + membership fetches.
		const dispatcher = this.proxyDispatcher.resolve(connection, connection.baseUrl);

		if (!dryRun) {
			await this.assertRealSyncNotInProgress(connectionId, connection);
		}

		const runningLog = await this.syncLogService.createRunningLog(connectionId, triggerSource);

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
		let usersSkippedCollision = 0;
		// Cross-connection username collision policy: per-connection override → global default (Prompt 37).
		const collisionPolicy: UsernameCollisionPolicy =
			(connection.usernameCollisionPolicy as UsernameCollisionPolicy | null) ??
			this.multiSourceConfig.usernameCollisionPolicy();
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
						dispatcher,
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
							dispatcher,
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
						if (error instanceof UsernameCollisionError) {
							usersSkippedCollision += 1;
							await this.recordUsernameCollision(errors, error, connectionId);
							// Strict deployments fail the whole connection run on any collision (Prompt 37).
							if (collisionPolicy === 'fail_run') {
								throw new StrictRowError();
							}
							continue;
						}
						this.pushUpsertUserError(errors, user.id);
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
				dispatcher,
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
				{ usersSynced, groupsSynced, rolesSynced, usersSkippedCollision },
				errors.length > 0 ? errors : null,
			);

			let connectionAfter = connectionBefore;
			if (!dryRun) {
				// A successful real run clears any scheduled-failure backoff state and lifts an auto-pause
				// (Prompt 32, deliverable 13) — both for scheduled runs and for a manual "Run now" recovery.
				const clearAutoPause = connectionBefore.scheduleAutoPausedAt != null;
				connectionAfter = await this.prisma.apiConnection.update({
					where: { id: connectionId },
					data: {
						lastSyncAt: finishedLog.finishedAt ?? new Date(),
						lastSyncStatus: 'SUCCESS',
						lastCollisionCount: usersSkippedCollision,
						scheduleConsecutiveFailures: 0,
						scheduleAutoPausedAt: null,
						scheduleLastError: null,
						...(clearAutoPause ? { schedulePaused: false } : {}),
					},
				});
			}

			this.recordSyncAudit('sync_completed', finishedLog.id, options, {
				usersSynced,
				usersSkippedCollision,
				status: 'SUCCESS',
			});
			return {
				syncLog: toSyncLogDto(finishedLog),
				connection: toApiConnectionDto(connectionAfter),
			};
		} catch (error) {
			// §5.B3: a StrictRowError (onRowError='fail' / collision fail_run) has already pushed its
			// describing entry before aborting. Any OTHER throw (e.g. in replaceUserGroups or
			// deactivateUsersNotInExternalIds) would otherwise yield a FAILED log with no error entry —
			// record an explicit internal error so the failure is self-describing.
			if (!(error instanceof StrictRowError)) {
				errors.push({
					phase: 'internal',
					message: error instanceof Error ? error.message : String(error),
				});
			}
			return this.finishFailedTrigger(
				connectionId,
				connectionBefore,
				runningLog.id,
				dryRun,
				errors,
				{ usersSynced, groupsSynced, rolesSynced, usersSkippedCollision },
				auditContext,
			);
		}
	}

	/**
	 * "Sync all sources" (Prompt 37): trigger a sync for every included non-local connection, with bounded
	 * concurrency, isolating failures, skipping in-progress connections. Connections are processed in
	 * `createdAt` order so the cross-source collision winner is deterministic at concurrency 1.
	 */
	async syncAll(options: {
		dryRun?: boolean;
		adminId?: string;
		adminUsername?: string;
	}): Promise<SyncAllResponseDto> {
		const dryRun = options.dryRun === true;
		const connections = await this.prisma.apiConnection.findMany({
			where: { isLocalDirectory: false, includeInSyncAll: true },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		});
		// Non-local connections opted out of "sync all" — surfaced as `excluded` results so they aren't
		// silently invisible (Prompt 38 §B3); they are never contacted.
		const excludedConnections = await this.prisma.apiConnection.findMany({
			where: { isLocalDirectory: false, includeInSyncAll: false },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		});
		const byId = new Map<string, SyncAllConnectionResultDto>();
		const concurrency = this.effectiveSyncAllConcurrency(connections);

		await this.runPool(connections, concurrency, async (c) => {
			if (!dryRun && (await this.isSyncInProgress(c.id))) {
				byId.set(c.id, this.skippedResult(c.id, c.name));
				return;
			}
			try {
				const res = await this.triggerSync(c.id, {
					dryRun,
					triggerSource: 'manual_all',
					adminId: options.adminId,
					adminUsername: options.adminUsername,
				});
				const log = res.syncLog;
				byId.set(c.id, {
					connectionId: c.id,
					name: c.name,
					status: log.status === 'FAILED' ? 'failed' : 'succeeded',
					usersSynced: log.usersSynced,
					groupsSynced: log.groupsSynced,
					rolesSynced: log.rolesSynced,
					usersSkippedCollision: log.usersSkippedCollision ?? 0,
				});
			} catch (error) {
				// A concurrent in-progress race surfaces as a Conflict — report it as skipped, not failed.
				if (error instanceof ConflictException) {
					byId.set(c.id, this.skippedResult(c.id, c.name));
					return;
				}
				byId.set(c.id, {
					connectionId: c.id,
					name: c.name,
					status: 'failed',
					usersSynced: 0,
					groupsSynced: 0,
					rolesSynced: 0,
					usersSkippedCollision: 0,
					message: error instanceof Error ? error.message : 'sync_failed',
				});
			}
		});

		// Stable output in createdAt order (runPool may complete out of order); excluded sources last.
		const includedResults = connections.map(
			(c) => byId.get(c.id) ?? this.skippedResult(c.id, c.name),
		);
		const excludedResults = excludedConnections.map((c) => this.excludedResult(c.id, c.name));
		const results = [...includedResults, ...excludedResults];
		const totals = {
			connections: results.length,
			succeeded: results.filter((r) => r.status === 'succeeded').length,
			failed: results.filter((r) => r.status === 'failed').length,
			skippedInProgress: results.filter((r) => r.status === 'skipped_in_progress').length,
			excluded: excludedResults.length,
			usersSynced: results.reduce((n, r) => n + r.usersSynced, 0),
			usersSkippedCollision: results.reduce((n, r) => n + r.usersSkippedCollision, 0),
		};
		this.audit.recordSafe({
			category: 'sync',
			event: 'identity_sync_all_triggered',
			actorType: options.adminId ? 'admin' : 'system',
			actorId: options.adminId,
			metadata: { connections: results.length, dryRun },
		});
		return { dryRun, results, totals };
	}

	private skippedResult(connectionId: string, name: string): SyncAllConnectionResultDto {
		return {
			connectionId,
			name,
			status: 'skipped_in_progress',
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
			usersSkippedCollision: 0,
		};
	}

	private excludedResult(connectionId: string, name: string): SyncAllConnectionResultDto {
		return {
			connectionId,
			name,
			status: 'excluded',
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
			usersSkippedCollision: 0,
		};
	}

	/** Endpoint mode: bounded-parallel raw fetch. Embedded mode: synchronous extract. */
	private async gatherMemberships(
		baseUrl: string,
		bearerToken: string,
		contract: ResolvedApiContract,
		processed: ProcessedUser[],
		dispatcher?: Dispatcher,
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
						dispatcher,
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
						dispatcher,
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

	/**
	 * §B3: the "first connection (createdAt order) wins a cross-source username collision" guarantee
	 * only holds when the sources run sequentially. Parallelism is therefore allowed only when every
	 * included connection uses the `fail_run` collision policy (a collision then fails the colliding
	 * run loudly instead of silently picking a racy winner); otherwise the configured concurrency is
	 * clamped to 1 with a warning.
	 */
	private effectiveSyncAllConcurrency(connections: ApiConnection[]): number {
		const configured = this.multiSourceConfig.syncAllConcurrency();
		if (configured <= 1) {
			return configured;
		}
		const globalPolicy = this.multiSourceConfig.usernameCollisionPolicy();
		const allFailRun = connections.every(
			(c) =>
				((c.usernameCollisionPolicy as UsernameCollisionPolicy | null) ?? globalPolicy) ===
				'fail_run',
		);
		if (allFailRun) {
			return configured;
		}
		this.logger.warn(
			`SYNC_ALL_CONCURRENCY=${configured} clamped to 1: at least one included connection uses the ` +
				`'skip' username-collision policy, and the first-connection-wins order is only deterministic ` +
				`sequentially. Set every connection to 'fail_run' to allow parallel "sync all".`,
		);
		return 1;
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

	/**
	 * True when a real (non-stale) sync is currently running for the connection. A stale open run is
	 * treated as NOT in progress (it is reclaimable). Used by the scheduler to pre-check before
	 * triggering, so a stale/hung run never blocks future scheduled slots (Prompt 32, deliverable 15).
	 */
	async isSyncInProgress(connectionId: string): Promise<boolean> {
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			return false;
		}
		return this.isRealSyncInProgress(connectionId, connection);
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

	async listSyncLogs(
		connectionId: string,
		limit: number,
		triggerSource?: SyncTriggerSource,
	): Promise<SyncLogListResponseDto> {
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		const logs = await this.syncLogService.listLogsForConnection(
			connectionId,
			limit,
			triggerSource,
		);
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
		counters: {
			usersSynced: number;
			groupsSynced: number;
			rolesSynced: number;
			usersSkippedCollision?: number;
		},
		options?: { adminId?: string; adminUsername?: string },
	): Promise<TriggerSyncResponseDto> {
		const finishedLog = await this.syncLogService.finishLog(logId, 'FAILED', counters, errors);
		this.recordSyncAudit('sync_failed', finishedLog.id, options, {
			usersSynced: counters.usersSynced,
			usersSkippedCollision: counters.usersSkippedCollision ?? 0,
			status: 'FAILED',
		});
		let connectionAfter = connectionBefore;
		if (!dryRun) {
			connectionAfter = await this.prisma.apiConnection.update({
				where: { id: connectionId },
				data: {
					lastSyncStatus: 'FAILED',
					lastCollisionCount: counters.usersSkippedCollision ?? 0,
				},
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

	private pushUpsertUserError(errors: SyncLogErrorEntryDto[], externalUserId: string): void {
		errors.push({
			phase: 'upsert_user',
			externalUserId,
			message: 'Failed to upsert user',
		});
	}

	/**
	 * Record a cross-connection username collision as a first-class outcome (Prompt 37): a distinct
	 * `username_collision` error entry that names the current owner (the record kept), plus a system audit
	 * event. No secrets; the colliding record is skipped, the owner is never overwritten.
	 */
	private async recordUsernameCollision(
		errors: SyncLogErrorEntryDto[],
		error: UsernameCollisionError,
		connectionId: string,
	): Promise<void> {
		let owner: {
			apiConnectionId: string;
			apiConnection: { name: string; isLocalDirectory: boolean };
		} | null = null;
		try {
			owner = await this.prisma.user.findUnique({
				where: { username: error.username },
				select: {
					apiConnectionId: true,
					apiConnection: { select: { name: true, isLocalDirectory: true } },
				},
			});
		} catch {
			owner = null;
		}
		const ownerLabel = owner
			? owner.apiConnection.isLocalDirectory
				? 'Local directory'
				: owner.apiConnection.name
			: undefined;
		errors.push({
			phase: 'username_collision',
			externalUserId: error.externalUserId,
			username: error.username,
			ownerApiConnectionId: owner?.apiConnectionId,
			ownerLabel,
			message: `Username "${error.username}" already owned by ${ownerLabel ?? 'another source'}`,
		});
		this.audit.recordSafe({
			category: 'sync',
			event: 'identity_sync_username_collision',
			actorType: 'system',
			subjectType: 'ApiConnection',
			subjectId: connectionId,
			metadata: {
				username: error.username,
				externalId: error.externalUserId,
				ownerApiConnectionId: owner?.apiConnectionId,
			},
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
