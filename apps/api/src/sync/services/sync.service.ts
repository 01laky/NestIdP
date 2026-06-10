import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import type {
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
import { ApiConnection, SyncLog } from '@prisma/client';
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
import {
	type MembershipDescriptor,
	type MembershipEntityKind,
} from '../utils/membership-descriptor';
import { SyncCounters } from '../utils/sync-counters';
import { SyncErrors } from '../utils/sync-errors';
import {
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

/** Immutable per-run inputs shared by the phase methods (resolved once in beginRun). */
interface SyncRunContext {
	connection: ApiConnection;
	contract: ResolvedApiContract;
	dispatcher: Dispatcher | undefined;
	dryRun: boolean;
}

interface MembershipRaw {
	externalUserId: string;
	rawByKind: Partial<Record<MembershipEntityKind, unknown[]>>;
	errorByKind: Partial<Record<MembershipEntityKind, unknown>>;
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
		const { ctx, connectionBefore, runningLog } = await this.beginRun(
			connectionId,
			dryRun,
			options?.triggerSource ?? 'manual',
		);
		const errors = new SyncErrors();
		const counters = new SyncCounters();
		const finalize = (status: 'SUCCESS' | 'FAILED') =>
			this.finalizeRun({
				status,
				connectionId,
				connectionBefore,
				logId: runningLog.id,
				dryRun,
				errors,
				counters,
				auditContext: { adminId: options?.adminId, adminUsername: options?.adminUsername },
			});

		try {
			// `null` ⇒ bearer/fetch-users failure; the describing error entry is already recorded.
			const fetched = await this.fetchAndMapUsers(ctx, counters, errors);
			if (fetched == null) {
				return finalize('FAILED');
			}
			await this.applyUserMemberships(ctx, fetched, counters, errors);
			await this.deactivateOrphans(connectionId, counters, dryRun);
			if (dryRun) {
				errors.add(DRY_RUN_SUMMARY_PHASE, DRY_RUN_SUMMARY_MESSAGE);
			}
			return finalize('SUCCESS');
		} catch (error) {
			// §5.B3: a StrictRowError has already pushed its describing entry before aborting; any
			// OTHER throw gets an explicit 'internal' entry so a FAILED log is always self-describing.
			if (!(error instanceof StrictRowError)) {
				errors.add('internal', error instanceof Error ? error.message : String(error));
			}
			return finalize('FAILED');
		}
	}

	/** Load + validate the connection and claim the run: concurrency guard, RUNNING log, IN_PROGRESS. */
	private async beginRun(
		connectionId: string,
		dryRun: boolean,
		triggerSource: SyncTriggerSource,
	): Promise<{ ctx: SyncRunContext; connectionBefore: ApiConnection; runningLog: SyncLog }> {
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
		return { ctx: { connection, contract, dispatcher, dryRun }, connectionBefore, runningLog };
	}

	/**
	 * Phase A: resolve the bearer, fetch the users page(s), map + upsert rows. Returns `null` after
	 * pushing the describing entry when the bearer or the users fetch fails — the orchestrator then
	 * finalizes FAILED (null-return pattern; no flow-control exception). Row-level problems are
	 * recorded per row and the run continues, unless StrictRowError aborts the whole run.
	 */
	private async fetchAndMapUsers(
		ctx: SyncRunContext,
		counters: SyncCounters,
		errors: SyncErrors,
	): Promise<{ processed: ProcessedUser[]; bearerToken: string } | null> {
		const { connection, contract, dryRun } = ctx;
		let bearerToken = await this.resolveBearer(connection, errors);
		if (bearerToken == null) {
			return null;
		}

		let usersBody: unknown[];
		try {
			let raw: unknown;
			try {
				raw = await this.identitySyncClient.fetchUsersRaw(
					connection.baseUrl,
					bearerToken,
					contract,
					ctx.dispatcher,
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
						ctx.dispatcher,
					);
				} else {
					throw error;
				}
			}
			usersBody = assertUsersArrayWithinLimit(raw, this.identitySyncClient.getMaxUsersPerRun());
			if (detectDuplicateUserIds(usersBody, contract.userFieldMap.id)) {
				errors.add(
					'parse_users',
					'Duplicate user ids in external API response; last row wins per id',
				);
			}
		} catch (error) {
			pushFetchUsersError(errors, error);
			return null;
		}

		const userRowsById = new Map<string, unknown>();
		for (let rowIndex = 0; rowIndex < usersBody.length; rowIndex += 1) {
			const rawRow = usersBody[rowIndex];
			const idValue = getByPath(rawRow, contract.userFieldMap.id);
			if (typeof idValue === 'string' && idValue.trim().length > 0) {
				userRowsById.set(idValue.trim(), rawRow);
			} else {
				// §5.C: a dropped row would otherwise vanish silently AND its existing local user would be
				// deactivated (not in seenUserExternalIds) — record an explicit, recoverable error.
				errors.add(
					'parse_users',
					idValue == null
						? `Row ${rowIndex}: missing user id at "${contract.userFieldMap.id}" — row skipped`
						: `Row ${rowIndex}: non-string or empty user id at "${contract.userFieldMap.id}" — row skipped`,
				);
			}
		}

		// Cross-connection username collision policy: per-connection override → global default (Prompt 37).
		// §5.C: the stored override is validated (not blind-cast) — an unknown value falls back to global.
		const collisionPolicy: UsernameCollisionPolicy =
			typeof connection.usernameCollisionPolicy === 'string' &&
			isUsernameCollisionPolicy(connection.usernameCollisionPolicy)
				? connection.usernameCollisionPolicy
				: this.multiSourceConfig.usernameCollisionPolicy();

		// --- Phase 1: map + upsert users (sequential, deterministic order) ---
		const processed: ProcessedUser[] = [];
		for (const [externalUserId, rawRow] of userRowsById) {
			counters.seenUserExternalIds.add(externalUserId);
			let user;
			try {
				user = mapExternalUserRow(rawRow, {
					fieldMap: contract.userFieldMap,
					passwordHashAlgorithmConstant: contract.passwordHashAlgorithmConstant,
					activeMapping: contract.activeMapping,
					defaults: contract.defaults,
				});
			} catch (error) {
				errors.add(
					'parse_users',
					error instanceof ExternalApiValidationError ? error.message : 'Invalid user row',
					{ externalUserId },
				);
				if (contract.onRowError === 'fail') {
					throw new StrictRowError();
				}
				continue;
			}

			let localUserId: string | null = null;
			if (dryRun) {
				counters.addUser();
			} else {
				try {
					const row = await this.identityRepository.upsertUser(connection.id, {
						externalId: user.id,
						username: user.username,
						email: user.email ?? null,
						displayName: user.displayName ?? null,
						passwordHash: user.passwordHash,
						passwordHashAlgorithm: user.passwordHashAlgorithm,
						active: user.active,
					});
					localUserId = row.id;
					counters.addUser();
				} catch (error) {
					if (error instanceof UsernameCollisionError) {
						counters.addCollision();
						await this.recordUsernameCollision(errors, error, connection.id);
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
		return { processed, bearerToken };
	}

	/** Phase B: gather raw memberships (bounded-parallel), then map + upsert + replace per user. */
	private async applyUserMemberships(
		ctx: SyncRunContext,
		fetched: { processed: ProcessedUser[]; bearerToken: string },
		counters: SyncCounters,
		errors: SyncErrors,
	): Promise<void> {
		const { processed, bearerToken } = fetched;
		const { connection, contract, dispatcher, dryRun } = ctx;
		const membershipKinds: readonly MembershipDescriptor[] = [
			{
				kind: 'group',
				mapRow: mapExternalGroupRow,
				fieldMap: contract.groupFieldMap,
				embedded: contract.membershipSource.groups.mode === 'embedded',
				embeddedPath: contract.membershipSource.groups.embeddedPath,
				embeddedCap: contract.maxGroupsPerUser,
				fetchRaw: (externalUserId) =>
					this.identitySyncClient.fetchGroupsRawForUser(
						connection.baseUrl,
						bearerToken,
						externalUserId,
						contract,
						dispatcher,
					),
				upsert: (mapped) => this.identityRepository.upsertGroup(connection.id, mapped),
				replace: (localUserId, memberIds) =>
					this.identityRepository.replaceUserGroups(localUserId, memberIds),
				markSeen: (externalId) => {
					counters.seenGroupExternalIds.add(externalId);
				},
				addOnce: (externalId) => counters.addGroupOnce(externalId),
			} satisfies MembershipDescriptor,
			{
				kind: 'role',
				mapRow: mapExternalRoleRow,
				fieldMap: contract.roleFieldMap,
				embedded: contract.membershipSource.roles.mode === 'embedded',
				embeddedPath: contract.membershipSource.roles.embeddedPath,
				embeddedCap: contract.maxRolesPerUser,
				fetchRaw: (externalUserId) =>
					this.identitySyncClient.fetchRolesRawForUser(
						connection.baseUrl,
						bearerToken,
						externalUserId,
						contract,
						dispatcher,
					),
				upsert: (mapped) => this.identityRepository.upsertRole(connection.id, mapped),
				replace: (localUserId, memberIds) =>
					this.identityRepository.replaceUserRoles(localUserId, memberIds),
				markSeen: (externalId) => {
					counters.seenRoleExternalIds.add(externalId);
				},
				addOnce: (externalId) => counters.addRoleOnce(externalId),
			} satisfies MembershipDescriptor,
		];

		// --- Phase 2: gather raw memberships (bounded-parallel HTTP for endpoint mode) ---
		const memberships = await this.gatherMemberships(processed, membershipKinds);

		// --- Phase 3: map + upsert memberships (sequential, original order) ---
		for (const processedUser of processed) {
			const m = memberships.get(processedUser.externalUserId);
			for (const kind of membershipKinds) {
				const fetchError = m?.errorByKind[kind.kind];
				if (fetchError) {
					pushMembershipFetchError(errors, kind.kind, processedUser.externalUserId, fetchError);
					continue;
				}
				const rawRows = m?.rawByKind[kind.kind];
				if (!rawRows) {
					continue;
				}
				const memberIds = await this.applyMemberships(processedUser, rawRows, kind, {
					dryRun,
					errors,
				});
				if (!dryRun && processedUser.localUserId) {
					await kind.replace(processedUser.localUserId, memberIds);
				}
			}
		}
	}

	/** Phase C: deactivate users and delete orphan groups/roles not seen this run (real runs only). */
	private async deactivateOrphans(
		connectionId: string,
		counters: SyncCounters,
		dryRun: boolean,
	): Promise<void> {
		if (dryRun) {
			return;
		}
		await this.identityRepository.deactivateUsersNotInExternalIds(
			connectionId,
			counters.seenUserExternalIds,
		);
		counters.setDeactivated(
			'group',
			await this.identityRepository.deleteOrphanGroups(connectionId, counters.seenGroupExternalIds),
		);
		counters.setDeactivated(
			'role',
			await this.identityRepository.deleteOrphanRoles(connectionId, counters.seenRoleExternalIds),
		);
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

	/** Endpoint mode: bounded-parallel raw fetch. Embedded mode: synchronous extract. */
	private async gatherMemberships(
		processed: ProcessedUser[],
		kinds: readonly MembershipDescriptor[],
	): Promise<Map<string, MembershipRaw>> {
		// runPoolMap (worker → R[]) was considered here (Prompt 39 D2) and rejected: the worker is
		// shared with the embedded-mode serial path below and the results are keyed by externalUserId,
		// so collecting an array and re-indexing it afterwards would add a step without removing the
		// accumulator — the Map is the natural shape, not an incidental one.
		const result = new Map<string, MembershipRaw>();

		const worker = async (p: ProcessedUser): Promise<void> => {
			const entry: MembershipRaw = {
				externalUserId: p.externalUserId,
				rawByKind: {},
				errorByKind: {},
			};
			for (const kind of kinds) {
				if (kind.embedded) {
					entry.rawByKind[kind.kind] = this.extractEmbedded(
						p.rawRow,
						kind.embeddedPath,
						kind.embeddedCap,
					);
				} else {
					try {
						entry.rawByKind[kind.kind] = await kind.fetchRaw(p.externalUserId);
					} catch (error) {
						entry.errorByKind[kind.kind] = error;
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
		kind: MembershipDescriptor,
		ctx: {
			dryRun: boolean;
			errors: SyncErrors;
		},
	): Promise<string[]> {
		const memberIds: string[] = [];
		for (const raw of rawRows) {
			let mapped: ExternalGroupDto | ExternalRoleDto;
			try {
				mapped = kind.mapRow(raw, kind.fieldMap);
			} catch (error) {
				pushMembershipRowParseError(ctx.errors, kind.kind, processedUser.externalUserId, error);
				continue;
			}
			kind.markSeen(mapped.id);
			if (ctx.dryRun) {
				// Dry run counts distinct upsert candidates without writing.
				kind.addOnce(mapped.id);
				continue;
			}
			try {
				const row = await kind.upsert(mapped);
				kind.addOnce(mapped.id);
				memberIds.push(row.id);
			} catch (error) {
				pushUpsertEntityError(
					ctx.errors,
					kind.kind,
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
		errors: SyncErrors,
	): Promise<string | null> {
		if (connection.authType === 'OAUTH2_CLIENT_CREDENTIALS') {
			try {
				return await this.oauthTokenService.getAccessToken(connection);
			} catch (error) {
				errors.add(
					'oauth',
					error instanceof OAuthTokenError ? error.message : 'OAuth token acquisition failed',
					{ httpStatus: error instanceof OAuthTokenError ? error.options.statusCode : undefined },
				);
				return null;
			}
		}
		return this.decryptCredentials(connection.authCredentialsEncrypted, errors);
	}

	private decryptCredentials(authCredentialsEncrypted: string, errors: SyncErrors): string | null {
		try {
			return this.encryption.decrypt(authCredentialsEncrypted);
		} catch {
			errors.add('decrypt_credentials', 'Stored credentials could not be decrypted');
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
	 * connection update (the historical order). §5.B3: the full six-field counter snapshot is
	 * carried on every terminal path — early exits report a genuine 0, never an omitted field.
	 */
	private async finalizeRun(params: {
		status: 'SUCCESS' | 'FAILED';
		connectionId: string;
		connectionBefore: ApiConnection;
		logId: string;
		dryRun: boolean;
		errors: SyncErrors;
		counters: SyncCounters;
		auditContext?: { adminId?: string; adminUsername?: string };
	}): Promise<TriggerSyncResponseDto> {
		const { status, dryRun } = params;
		const errors = params.errors.toArray();
		const counters = params.counters.toCounterSnapshot();
		const finishedLog = await this.syncLogService.finishLog(
			params.logId,
			status,
			counters,
			status === 'SUCCESS' ? (errors.length > 0 ? errors : null) : errors,
		);
		const auditMetadata = {
			usersSynced: counters.usersSynced,
			usersSkippedCollision: counters.usersSkippedCollision,
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
						lastCollisionCount: counters.usersSkippedCollision,
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
						lastCollisionCount: counters.usersSkippedCollision,
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
				{
					usersSynced: 0,
					groupsSynced: 0,
					rolesSynced: 0,
					usersSkippedCollision: 0,
					groupsDeactivated: 0,
					rolesDeactivated: 0,
				},
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
		errors: SyncErrors,
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
		errors.add(
			'username_collision',
			`Username "${error.username}" already owned by ${ownerLabel ?? 'another source'}`,
			{
				externalUserId: error.externalUserId,
				username: error.username,
				ownerApiConnectionId: owner?.apiConnectionId,
				ownerLabel,
			},
		);
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
