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
import { getByPath, isUsernameCollisionPolicy, resolveApiContract } from '@nestidp/shared';
import { SyncMultiSourceConfig } from './sync-multi-source.config';
import { ApiConnection } from '@prisma/client';
import { toApiConnectionDto } from '../../api-connections/mappers/api-connections.mapper';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { UsernameCollisionError } from '../../identity/identity.repository';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import { runPool } from '../../common/utils/run-pool.util';
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
import { SyncCounters } from './sync-counters';
import {
	GROUP_ERROR_DESCRIPTOR,
	ROLE_ERROR_DESCRIPTOR,
	type MembershipErrorDescriptor,
	pushFetchUsersError,
	pushMembershipFetchError,
	pushMembershipRowParseError,
	pushUpsertEntityError,
	pushUpsertUserError,
} from './sync-error-entries.util';
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
	rawByKind: Partial<Record<MembershipKindKey, unknown[]>>;
	errorByKind: Partial<Record<MembershipKindKey, unknown>>;
}

type MembershipKindKey = 'groups' | 'roles';

/**
 * Per-run descriptor for one membership kind (Prompt 38 §6.8c): the groups and roles paths are
 * mirrors of each other — everything that differs between them lives here.
 */
interface MembershipKind {
	key: MembershipKindKey;
	fetchPhase: 'fetch_groups' | 'fetch_roles';
	errorDescriptor: MembershipErrorDescriptor;
	mapRow: (
		raw: unknown,
		fieldMap: { id: string; name: string },
	) => ExternalGroupDto | ExternalRoleDto;
	fieldMap: { id: string; name: string };
	embedded: boolean;
	embeddedPath?: string;
	embeddedCap: number | null;
	fetchRaw: (externalUserId: string) => Promise<unknown[]>;
	upsert: (mapped: ExternalGroupDto | ExternalRoleDto) => Promise<{ id: string }>;
	replace: (localUserId: string, memberIds: string[]) => Promise<void>;
	counterKey: 'groupsSynced' | 'rolesSynced';
	seen: Set<string>;
	upserted: Set<string>;
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
		const counters = new SyncCounters();
		// Cross-connection username collision policy: per-connection override → global default (Prompt 37).
		// §5.C: the stored override is validated (not blind-cast) — an unknown value falls back to global.
		const collisionPolicy: UsernameCollisionPolicy =
			typeof connection.usernameCollisionPolicy === 'string' &&
			isUsernameCollisionPolicy(connection.usernameCollisionPolicy)
				? connection.usernameCollisionPolicy
				: this.multiSourceConfig.usernameCollisionPolicy();
		const seenGroupExternalIds = new Set<string>();
		const seenRoleExternalIds = new Set<string>();
		const auditContext = {
			adminId: options?.adminId,
			adminUsername: options?.adminUsername,
		};

		try {
			let bearerToken = await this.resolveBearer(connection, errors);
			if (bearerToken == null) {
				return this.finalizeRun({
					status: 'FAILED',
					connectionId,
					connectionBefore,
					logId: runningLog.id,
					dryRun,
					errors,
					counters: counters.withoutCollisions(),
					auditContext,
				});
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
				pushFetchUsersError(errors, error);
				return this.finalizeRun({
					status: 'FAILED',
					connectionId,
					connectionBefore,
					logId: runningLog.id,
					dryRun,
					errors,
					counters: counters.withoutCollisions(),
					auditContext,
				});
			}

			const seenUserExternalIds = new Set<string>();
			const userRowsById = new Map<string, unknown>();
			for (let rowIndex = 0; rowIndex < usersBody.length; rowIndex += 1) {
				const rawRow = usersBody[rowIndex];
				const idValue = getByPath(rawRow, contract.userFieldMap.id);
				if (typeof idValue === 'string' && idValue.trim().length > 0) {
					userRowsById.set(idValue.trim(), rawRow);
				} else {
					// §5.C: a dropped row would otherwise vanish silently AND its existing local user would be
					// deactivated (not in seenUserExternalIds) — record an explicit, recoverable error.
					errors.push({
						phase: 'parse_users',
						message:
							idValue == null
								? `Row ${rowIndex}: missing user id at "${contract.userFieldMap.id}" — row skipped`
								: `Row ${rowIndex}: non-string or empty user id at "${contract.userFieldMap.id}" — row skipped`,
					});
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
					counters.usersSynced += 1;
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
						counters.usersSynced += 1;
					} catch (error) {
						if (error instanceof UsernameCollisionError) {
							counters.usersSkippedCollision += 1;
							await this.recordUsernameCollision(errors, error, connectionId);
							// Strict deployments fail the whole connection run on any collision (Prompt 37).
							if (collisionPolicy === 'fail_run') {
								throw new StrictRowError();
							}
							continue;
						}
						pushUpsertUserError(errors, user.id);
						continue;
					}
				}
				processed.push({ externalUserId, rawRow, localUserId });
			}

			const membershipKinds = this.buildMembershipKinds(
				connectionId,
				connection.baseUrl,
				bearerToken,
				contract,
				dispatcher,
				{ groups: seenGroupExternalIds, roles: seenRoleExternalIds },
			);

			// --- Phase 2: gather raw memberships (bounded-parallel HTTP for endpoint mode) ---
			const memberships = await this.gatherMemberships(processed, membershipKinds);

			// --- Phase 3: map + upsert memberships (sequential, original order) ---
			for (const processedUser of processed) {
				const m = memberships.get(processedUser.externalUserId);
				for (const kind of membershipKinds) {
					const fetchError = m?.errorByKind[kind.key];
					if (fetchError) {
						pushMembershipFetchError(
							errors,
							kind.fetchPhase,
							processedUser.externalUserId,
							fetchError,
						);
						continue;
					}
					const rawRows = m?.rawByKind[kind.key];
					if (!rawRows) {
						continue;
					}
					const memberIds = await this.applyMemberships(
						processedUser,
						rawRows,
						kind,
						{ dryRun, errors },
						counters,
					);
					if (!dryRun && processedUser.localUserId) {
						await kind.replace(processedUser.localUserId, memberIds);
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

			return this.finalizeRun({
				status: 'SUCCESS',
				connectionId,
				connectionBefore,
				logId: runningLog.id,
				dryRun,
				errors,
				counters: counters.snapshot(),
				auditContext,
			});
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
			return this.finalizeRun({
				status: 'FAILED',
				connectionId,
				connectionBefore,
				logId: runningLog.id,
				dryRun,
				errors,
				counters: counters.snapshot(),
				auditContext,
			});
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

		await runPool(connections, concurrency, async (c) => {
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

	/** Bind the static group/role descriptors to this run's contract, token, sets and store. */
	private buildMembershipKinds(
		connectionId: string,
		baseUrl: string,
		bearerToken: string,
		contract: ResolvedApiContract,
		dispatcher: Dispatcher | undefined,
		seen: { groups: Set<string>; roles: Set<string> },
	): [MembershipKind, MembershipKind] {
		return [
			{
				key: 'groups',
				fetchPhase: 'fetch_groups',
				errorDescriptor: GROUP_ERROR_DESCRIPTOR,
				mapRow: mapExternalGroupRow,
				fieldMap: contract.groupFieldMap,
				embedded: contract.membershipSource.groups.mode === 'embedded',
				embeddedPath: contract.membershipSource.groups.embeddedPath,
				embeddedCap: contract.maxGroupsPerUser,
				fetchRaw: (externalUserId) =>
					this.identitySyncClient.fetchGroupsRawForUser(
						baseUrl,
						bearerToken,
						externalUserId,
						contract,
						dispatcher,
					),
				upsert: (mapped) => this.identityRepository.upsertGroup(connectionId, mapped),
				replace: (localUserId, memberIds) =>
					this.identityRepository.replaceUserGroups(localUserId, memberIds),
				counterKey: 'groupsSynced',
				seen: seen.groups,
				upserted: new Set<string>(),
			},
			{
				key: 'roles',
				fetchPhase: 'fetch_roles',
				errorDescriptor: ROLE_ERROR_DESCRIPTOR,
				mapRow: mapExternalRoleRow,
				fieldMap: contract.roleFieldMap,
				embedded: contract.membershipSource.roles.mode === 'embedded',
				embeddedPath: contract.membershipSource.roles.embeddedPath,
				embeddedCap: contract.maxRolesPerUser,
				fetchRaw: (externalUserId) =>
					this.identitySyncClient.fetchRolesRawForUser(
						baseUrl,
						bearerToken,
						externalUserId,
						contract,
						dispatcher,
					),
				upsert: (mapped) => this.identityRepository.upsertRole(connectionId, mapped),
				replace: (localUserId, memberIds) =>
					this.identityRepository.replaceUserRoles(localUserId, memberIds),
				counterKey: 'rolesSynced',
				seen: seen.roles,
				upserted: new Set<string>(),
			},
		];
	}

	/** Endpoint mode: bounded-parallel raw fetch. Embedded mode: synchronous extract. */
	private async gatherMemberships(
		processed: ProcessedUser[],
		kinds: readonly MembershipKind[],
	): Promise<Map<string, MembershipRaw>> {
		const result = new Map<string, MembershipRaw>();

		const worker = async (p: ProcessedUser): Promise<void> => {
			const entry: MembershipRaw = {
				externalUserId: p.externalUserId,
				rawByKind: {},
				errorByKind: {},
			};
			for (const kind of kinds) {
				if (kind.embedded) {
					entry.rawByKind[kind.key] = this.extractEmbedded(
						p.rawRow,
						kind.embeddedPath,
						kind.embeddedCap,
					);
				} else {
					try {
						entry.rawByKind[kind.key] = await kind.fetchRaw(p.externalUserId);
					} catch (error) {
						entry.errorByKind[kind.key] = error;
					}
				}
			}
			result.set(p.externalUserId, entry);
		};

		if (kinds.every((kind) => kind.embedded)) {
			// No HTTP — extract inline, order irrelevant.
			for (const p of processed) {
				await worker(p);
			}
			return result;
		}

		await runPool(processed, this.identitySyncClient.getMembershipFetchConcurrency(), worker);
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
		processedUser: ProcessedUser,
		rawRows: unknown[],
		kind: MembershipKind,
		ctx: {
			dryRun: boolean;
			errors: SyncLogErrorEntryDto[];
		},
		counters: SyncCounters,
	): Promise<string[]> {
		const memberIds: string[] = [];
		for (const raw of rawRows) {
			let mapped: ExternalGroupDto | ExternalRoleDto;
			try {
				mapped = kind.mapRow(raw, kind.fieldMap);
			} catch (error) {
				pushMembershipRowParseError(
					ctx.errors,
					kind.errorDescriptor,
					processedUser.externalUserId,
					error,
				);
				continue;
			}
			kind.seen.add(mapped.id);
			if (ctx.dryRun) {
				if (!kind.upserted.has(mapped.id)) {
					kind.upserted.add(mapped.id);
					counters[kind.counterKey] += 1;
				}
				continue;
			}
			try {
				const row = await kind.upsert(mapped);
				if (!kind.upserted.has(mapped.id)) {
					kind.upserted.add(mapped.id);
					counters[kind.counterKey] += 1;
				}
				memberIds.push(row.id);
			} catch (error) {
				pushUpsertEntityError(
					ctx.errors,
					kind.errorDescriptor,
					processedUser.externalUserId,
					mapped.id,
					error,
				);
			}
		}
		return memberIds;
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

	/**
	 * Shared run-finish shape (Prompt 38 §6.8d): finish the log, update the connection status row
	 * (real runs only) and emit the completion/failure audit event. The success/failure asymmetries
	 * are deliberate and preserved: a SUCCESS log stores `null` instead of an empty errors array and
	 * clears the scheduled-failure backoff state; a FAILED run emits its audit event before the
	 * connection update (the historical order).
	 */
	private async finalizeRun(params: {
		status: 'SUCCESS' | 'FAILED';
		connectionId: string;
		connectionBefore: ApiConnection;
		logId: string;
		dryRun: boolean;
		errors: SyncLogErrorEntryDto[];
		counters: {
			usersSynced: number;
			groupsSynced: number;
			rolesSynced: number;
			usersSkippedCollision?: number;
		};
		auditContext?: { adminId?: string; adminUsername?: string };
	}): Promise<TriggerSyncResponseDto> {
		const { status, counters, errors, dryRun } = params;
		const finishedLog = await this.syncLogService.finishLog(
			params.logId,
			status,
			counters,
			status === 'SUCCESS' ? (errors.length > 0 ? errors : null) : errors,
		);
		const auditMetadata = {
			usersSynced: counters.usersSynced,
			usersSkippedCollision: counters.usersSkippedCollision ?? 0,
			status,
		};
		let connectionAfter = params.connectionBefore;
		if (status === 'SUCCESS') {
			if (!dryRun) {
				// A successful real run clears any scheduled-failure backoff state and lifts an auto-pause
				// (Prompt 32, deliverable 13) — both for scheduled runs and for a manual "Run now" recovery.
				const clearAutoPause = params.connectionBefore.scheduleAutoPausedAt != null;
				connectionAfter = await this.prisma.apiConnection.update({
					where: { id: params.connectionId },
					data: {
						lastSyncAt: finishedLog.finishedAt ?? new Date(),
						lastSyncStatus: 'SUCCESS',
						lastCollisionCount: counters.usersSkippedCollision ?? 0,
						scheduleConsecutiveFailures: 0,
						scheduleAutoPausedAt: null,
						scheduleLastError: null,
						...(clearAutoPause ? { schedulePaused: false } : {}),
					},
				});
			}
			this.recordSyncAudit('sync_completed', finishedLog.id, params.auditContext, auditMetadata);
		} else {
			this.recordSyncAudit('sync_failed', finishedLog.id, params.auditContext, auditMetadata);
			if (!dryRun) {
				connectionAfter = await this.prisma.apiConnection.update({
					where: { id: params.connectionId },
					data: {
						lastSyncStatus: 'FAILED',
						lastCollisionCount: counters.usersSkippedCollision ?? 0,
					},
				});
			}
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
		// Stale-run reclaim caveat (§5.C): "stale" is judged purely by run AGE — there is no heartbeat.
		// A healthy run that legitimately takes longer than SYNC_STALE_RUN_MINUTES is reclaimed here
		// (marked FAILED) and a new run starts, so the same connection can effectively be double-run.
		// Operators with very large/slow sources must raise SYNC_STALE_RUN_MINUTES above the worst-case
		// run duration.
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
}
