import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SyncLog } from '@prisma/client';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';
import {
	GroupNameCollisionError,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '@api/identity/identity.repository';
import { ActiveIdentityStore } from '@api/identity/store/active-identity-store';
import { ExternalApiValidationError } from '@api/sync/validators/external-api.validator';
import { IdentitySyncClientService } from '@api/sync/services/identity-sync-client.service';
import { IdentitySyncHttpError } from '@api/sync/identity-sync.errors';
import { DRY_RUN_SUMMARY_PHASE, DRY_RUN_SUMMARY_MESSAGE } from '@api/sync/mappers/sync.mapper';
import { SyncLogService, capSyncErrors } from '@api/sync/services/sync-log.service';
import { SyncService } from '@api/sync/services/sync.service';
import { fakeProxyDispatcher } from '@test/support/proxy-dispatcher.mock';

const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';
const CONNECTION_ID = 'c1234567890123456789012345';
const BEARER_TOKEN = 'plain-bearer-token';

function validExternalUser(overrides: Record<string, unknown> = {}) {
	return {
		id: 'ext-user-1',
		username: 'alice',
		passwordHash: TEST_PASSWORD_HASH,
		passwordHashAlgorithm: 'bcrypt',
		active: true,
		...overrides,
	};
}

describe('SyncService', () => {
	const prisma = {
		apiConnection: {
			findUnique: jest.fn(),
			update: jest.fn(),
			findMany: jest.fn().mockResolvedValue([]),
		},
	};

	const identityRepository = {
		upsertUser: jest.fn(),
		upsertGroup: jest.fn(),
		upsertRole: jest.fn(),
		replaceUserGroups: jest.fn(),
		replaceUserRoles: jest.fn(),
		deactivateUsersNotInExternalIds: jest.fn(),
		deleteOrphanGroups: jest.fn(),
		deleteOrphanRoles: jest.fn(),
	};

	const syncLogService = {
		createRunningLog: jest.fn(),
		finishLog: jest.fn(),
		getOpenRunningLog: jest.fn(),
		getLatestLogForConnection: jest.fn(),
		listLogsForConnection: jest.fn(),
		getLogById: jest.fn(),
	};

	const identitySyncClient = {
		fetchUsersRaw: jest.fn(),
		fetchGroupsRawForUser: jest.fn(),
		fetchRolesRawForUser: jest.fn(),
		getMaxUsersPerRun: jest.fn().mockReturnValue(10_000),
		getStaleRunMinutes: jest.fn().mockReturnValue(30),
		getMembershipFetchConcurrency: jest.fn().mockReturnValue(5),
		getMaxGroupsPerUser: jest.fn().mockReturnValue(1000),
		getMaxRolesPerUser: jest.fn().mockReturnValue(1000),
	};

	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn(),
		decrypt: jest.fn().mockReturnValue(BEARER_TOKEN),
	};

	const audit = {
		recordSafe: jest.fn(),
	};

	const oauthTokenService = {
		getAccessToken: jest.fn(),
		getLastTokenAt: jest.fn().mockReturnValue(null),
		fetchDiagnostics: jest.fn(),
	};

	const service = new SyncService(
		prisma as never,
		identityRepository as unknown as ActiveIdentityStore,
		syncLogService as unknown as SyncLogService,
		identitySyncClient as unknown as IdentitySyncClientService,
		encryption,
		audit as never,
		oauthTokenService as never,
		fakeProxyDispatcher(),
		{
			usernameCollisionPolicy: () => 'skip',
			syncAllConcurrency: () => 1,
			syncSourceStaleFactor: () => 3,
		} as never,
	);

	const baseConnection = {
		id: CONNECTION_ID,
		name: 'Test API',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER' as const,
		authCredentialsEncrypted: 'enc:creds',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER' as const,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};

	const runningLog = {
		id: 'log-running',
		apiConnectionId: CONNECTION_ID,
		startedAt: new Date(),
		finishedAt: null,
		status: 'RUNNING' as const,
		usersSynced: 0,
		groupsSynced: 0,
		rolesSynced: 0,
		usersSkippedCollision: 0,
		groupsDeactivated: null,
		rolesDeactivated: null,
		errors: null,
		triggerSource: null,
	};

	function mockFinishedLog(overrides: Partial<SyncLog> = {}): SyncLog {
		const startedAt = new Date('2026-01-01T00:00:00.000Z');
		const finishedAt = new Date('2026-01-01T00:00:01.000Z');
		return {
			...runningLog,
			startedAt,
			finishedAt,
			status: 'SUCCESS',
			usersSynced: 1,
			groupsSynced: 1,
			rolesSynced: 1,
			...overrides,
		};
	}

	function setupHappyPathMocks() {
		prisma.apiConnection.findUnique.mockResolvedValue(baseConnection);
		syncLogService.getOpenRunningLog.mockResolvedValue(null);
		syncLogService.createRunningLog.mockResolvedValue(runningLog);
		identitySyncClient.fetchUsersRaw.mockResolvedValue([validExternalUser()]);
		identitySyncClient.fetchGroupsRawForUser.mockResolvedValue([{ id: 'g1', name: 'Engineering' }]);
		identitySyncClient.fetchRolesRawForUser.mockResolvedValue([{ id: 'r1', name: 'Admin' }]);
		identityRepository.upsertUser.mockResolvedValue({ id: 'local-user-1' });
		identityRepository.upsertGroup.mockResolvedValue({ id: 'local-group-1' });
		identityRepository.upsertRole.mockResolvedValue({ id: 'local-role-1' });
		identityRepository.replaceUserGroups.mockResolvedValue(undefined);
		identityRepository.replaceUserRoles.mockResolvedValue(undefined);
		identityRepository.deactivateUsersNotInExternalIds.mockResolvedValue(undefined);
		// The real repository returns the orphan delete COUNT (persisted since Prompt 39 D5).
		identityRepository.deleteOrphanGroups.mockResolvedValue(0);
		identityRepository.deleteOrphanRoles.mockResolvedValue(0);
		prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
			...baseConnection,
			...data,
			lastSyncAt: data.lastSyncAt ?? baseConnection.lastSyncAt,
			lastSyncStatus: data.lastSyncStatus ?? baseConnection.lastSyncStatus,
		}));
		syncLogService.finishLog.mockImplementation(async (_id, status, counters, errors) =>
			mockFinishedLog({
				status,
				usersSynced: counters.usersSynced,
				groupsSynced: counters.groupsSynced,
				rolesSynced: counters.rolesSynced,
				groupsDeactivated: counters.groupsDeactivated,
				rolesDeactivated: counters.rolesDeactivated,
				errors: capSyncErrors(errors) as SyncLog['errors'],
			}),
		);
	}

	beforeEach(() => {
		jest.clearAllMocks();
		encryption.decrypt.mockReturnValue(BEARER_TOKEN);
		identitySyncClient.getMaxUsersPerRun.mockReturnValue(10_000);
		identitySyncClient.getStaleRunMinutes.mockReturnValue(30);
	});

	it('API-SYNC-SVC-01: Happy path — 1 user, 1 group, 1 role', async () => {
		setupHappyPathMocks();

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.usersSynced).toBe(1);
		expect(result.syncLog.groupsSynced).toBe(1);
		expect(result.syncLog.rolesSynced).toBe(1);
		expect(identityRepository.upsertUser).toHaveBeenCalledTimes(1);
		expect(identityRepository.upsertGroup).toHaveBeenCalledTimes(1);
		expect(identityRepository.upsertRole).toHaveBeenCalledTimes(1);
		expect(identityRepository.replaceUserGroups).toHaveBeenCalledWith('local-user-1', [
			'local-group-1',
		]);
		expect(identityRepository.replaceUserRoles).toHaveBeenCalledWith('local-user-1', [
			'local-role-1',
		]);
	});

	it('API-SYNC-SVC-INTERNAL: an unexpected phase-3 throw records an internal error entry (§5.B3)', async () => {
		setupHappyPathMocks();
		identityRepository.deactivateUsersNotInExternalIds.mockRejectedValueOnce(
			new Error('db exploded mid-deactivation'),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		const errors = result.syncLog.errors ?? [];
		expect(errors.some((e) => e.phase === 'internal' && e.message.includes('db exploded'))).toBe(
			true,
		);
	});

	it('API-SYNC-SVC-02: GET /users failure → SyncLog FAILED', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 503', {
				statusCode: 503,
				reachable: true,
			}),
		);
		syncLogService.finishLog.mockResolvedValue(
			mockFinishedLog({ status: 'FAILED', usersSynced: 0, groupsSynced: 0, rolesSynced: 0 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'fetch_users', httpStatus: 503 })]),
		);
		expect(identityRepository.upsertUser).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-03: Decrypt failure → FAILED, no users written', async () => {
		setupHappyPathMocks();
		encryption.decrypt.mockImplementation(() => {
			throw new Error('bad ciphertext');
		});
		syncLogService.finishLog.mockResolvedValue(
			mockFinishedLog({ status: 'FAILED', usersSynced: 0, groupsSynced: 0, rolesSynced: 0 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'decrypt_credentials' })]),
		);
		expect(identitySyncClient.fetchUsersRaw).not.toHaveBeenCalled();
		expect(identityRepository.upsertUser).not.toHaveBeenCalled();
	});

	it('SVC-B3-EARLY-EXIT: bearer failure before any user fetch reports usersSkippedCollision: 0 (§5.B3)', async () => {
		setupHappyPathMocks();
		encryption.decrypt.mockImplementation(() => {
			throw new Error('bad ciphertext');
		});

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		// The counter is carried (a genuine 0), not omitted/re-defaulted, on the early-exit path.
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			{
				usersSynced: 0,
				groupsSynced: 0,
				rolesSynced: 0,
				usersSkippedCollision: 0,
				groupsDeactivated: 0,
				rolesDeactivated: 0,
			},
			expect.arrayContaining([expect.objectContaining({ phase: 'decrypt_credentials' })]),
		);
		expect(prisma.apiConnection.update).toHaveBeenCalledWith({
			where: { id: CONNECTION_ID },
			data: { lastSyncStatus: 'FAILED', lastCollisionCount: 0 },
		});
	});

	it('API-SYNC-SVC-04: User validation error → SUCCESS + errors[], other users proceed', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'bad', passwordHash: 'not-bcrypt' }),
			validExternalUser({ id: 'good', username: 'bob' }),
		]);
		syncLogService.finishLog.mockImplementation(async (_id, status, counters, errors) =>
			mockFinishedLog({
				status,
				usersSynced: counters.usersSynced,
				errors: errors as SyncLog['errors'],
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.usersSynced).toBe(1);
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'parse_users',
					externalUserId: 'bad',
				}),
			]),
		);
		expect(identityRepository.upsertUser).toHaveBeenCalledTimes(1);
	});

	it('API-SYNC-SVC-ROWID: numeric/missing external user ids are reported as parse_users errors, run continues (§5.C)', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'good', username: 'bob' }),
			validExternalUser({ id: 123, username: 'numeric' }),
			validExternalUser({ id: undefined, username: 'noid' }),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(identityRepository.upsertUser).toHaveBeenCalledTimes(1);
		const errors = result.syncLog.errors ?? [];
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'parse_users',
					message: expect.stringContaining('Row 1: non-string or empty user id'),
				}),
				expect.objectContaining({
					phase: 'parse_users',
					message: expect.stringContaining('Row 2: missing user id'),
				}),
			]),
		);
		// Only the valid row counts toward the deactivation snapshot.
		expect(identityRepository.deactivateUsersNotInExternalIds).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(['good']),
		);
	});

	it('API-SYNC-SVC-05: User removed from API → deactivated locally', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([validExternalUser({ id: 'kept' })]);

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.deactivateUsersNotInExternalIds).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(['kept']),
		);
	});

	it('API-SYNC-SVC-06: Empty users array → all local users deactivated', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.deactivateUsersNotInExternalIds).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(),
		);
		expect(result.syncLog.usersSynced).toBe(0);
		expect(result.syncLog.status).toBe('SUCCESS');
	});

	it('API-SYNC-SVC-06b: rows returned but NONE have a usable id → FAILED, no mass-deactivation', async () => {
		// Regression guard: the external API returns a non-empty body whose rows all lack a usable id
		// (e.g. the id field path was renamed upstream). seenUserExternalIds would be empty and
		// `notIn: []` would deactivate EVERY synced user. The run must abort (FAILED) instead.
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: undefined, username: 'noid-1' }),
			validExternalUser({ id: '', username: 'noid-2' }),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(result.syncLog.errors ?? []).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'parse_users',
					message: expect.stringContaining('none had a usable user id'),
				}),
			]),
		);
		// The catastrophic call must NOT happen.
		expect(identityRepository.deactivateUsersNotInExternalIds).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanGroups).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanRoles).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-20b: group membership fetch failure → orphan GROUP deletion skipped (no data loss)', async () => {
		// Regression guard: when a user's group fetch fails, that user's existing memberships are
		// preserved — but the group they reference is then "unseen" and would be orphan-deleted,
		// cascade-deleting the preserved memberships. Orphan deletion for groups must be skipped.
		setupHappyPathMocks();
		identitySyncClient.fetchGroupsRawForUser.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 503', {
				statusCode: 503,
				reachable: true,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		// Groups: fetch failed → orphan deletion skipped. Roles: fetched fine → still runs.
		expect(identityRepository.deleteOrphanGroups).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanRoles).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(['r1']),
		);
		expect(result.syncLog.groupsDeactivated).toBe(0);
	});

	it('API-SYNC-SVC-21b: role membership fetch failure → orphan ROLE deletion skipped (no data loss)', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchRolesRawForUser.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 502', {
				statusCode: 502,
				reachable: true,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(identityRepository.deleteOrphanRoles).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanGroups).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(['g1']),
		);
		expect(result.syncLog.rolesDeactivated).toBe(0);
	});

	it('API-SYNC-SVC-07: Concurrent sync → 409', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			lastSyncStatus: 'IN_PROGRESS',
		});
		syncLogService.getOpenRunningLog.mockResolvedValue({
			...runningLog,
			startedAt: new Date(),
		});

		await expect(service.triggerSync(CONNECTION_ID)).rejects.toThrow(ConflictException);
		expect(syncLogService.createRunningLog).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-08: Stale IN_PROGRESS → auto-fail previous + new run starts', async () => {
		const staleStartedAt = new Date(Date.now() - 60 * 60_000);
		const staleLog = { ...runningLog, startedAt: staleStartedAt };
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			lastSyncStatus: 'IN_PROGRESS',
		});
		syncLogService.getOpenRunningLog.mockResolvedValue(staleLog);
		syncLogService.createRunningLog.mockResolvedValue({ ...runningLog, id: 'log-new' });

		const result = await service.triggerSync(CONNECTION_ID);

		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			staleLog.id,
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
				expect.objectContaining({
					phase: 'concurrency',
					message: 'Previous sync run interrupted or timed out',
				}),
			],
		);
		expect(result.syncLog.status).toBe('SUCCESS');
	});

	it('API-SYNC-SVC-09: Updates lastSyncAt + lastSyncStatus on connection', async () => {
		setupHappyPathMocks();
		const finishedAt = new Date('2026-01-01T00:00:01.000Z');
		syncLogService.finishLog.mockResolvedValue(mockFinishedLog({ finishedAt, status: 'SUCCESS' }));

		const result = await service.triggerSync(CONNECTION_ID);

		expect(prisma.apiConnection.update).toHaveBeenCalledWith({
			where: { id: CONNECTION_ID },
			data: { lastSyncStatus: 'IN_PROGRESS' },
		});
		expect(prisma.apiConnection.update).toHaveBeenCalledWith({
			where: { id: CONNECTION_ID },
			data: {
				lastSyncAt: finishedAt,
				lastSyncStatus: 'SUCCESS',
				lastCollisionCount: 0,
				// A successful run also clears any scheduled-failure backoff state (Prompt 32).
				scheduleConsecutiveFailures: 0,
				scheduleAutoPausedAt: null,
				scheduleLastError: null,
			},
		});
		expect(result.connection.lastSyncStatus).toBe('SUCCESS');
		expect(result.connection.lastSyncAt).toBe(finishedAt.toISOString());
	});

	it('FIN-D4-01: FAILED run neither sets lastSyncAt nor clears the schedule backoff state', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 503', {
				statusCode: 503,
				reachable: true,
			}),
		);

		await service.triggerSync(CONNECTION_ID);

		const failedUpdate = prisma.apiConnection.update.mock.calls
			.map((call) => call[0])
			.find((call) => call.data.lastSyncStatus === 'FAILED');
		// Exact shape: no lastSyncAt, no scheduleConsecutiveFailures/scheduleAutoPausedAt reset.
		expect(failedUpdate).toEqual({
			where: { id: CONNECTION_ID },
			data: { lastSyncStatus: 'FAILED', lastCollisionCount: 0 },
		});
	});

	it('FIN-D4-02: SUCCESS while auto-paused (scheduleAutoPausedAt set) lifts the pause with schedulePaused: false', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			schedulePaused: true,
			scheduleAutoPausedAt: new Date('2026-01-01T00:00:00.000Z'),
		});

		await service.triggerSync(CONNECTION_ID);

		expect(prisma.apiConnection.update).toHaveBeenCalledWith({
			where: { id: CONNECTION_ID },
			data: expect.objectContaining({
				lastSyncStatus: 'SUCCESS',
				scheduleAutoPausedAt: null,
				schedulePaused: false,
			}),
		});
	});

	it('FIN-D4-03: SUCCESS without auto-pause (scheduleAutoPausedAt null) omits the schedulePaused key', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			scheduleAutoPausedAt: null,
		});

		await service.triggerSync(CONNECTION_ID);

		const successUpdate = prisma.apiConnection.update.mock.calls
			.map((call) => call[0])
			.find((call) => call.data.lastSyncStatus === 'SUCCESS');
		expect(successUpdate?.data).toEqual(
			expect.objectContaining({
				scheduleConsecutiveFailures: 0,
				scheduleAutoPausedAt: null,
				scheduleLastError: null,
			}),
		);
		// `schedulePaused` must be ABSENT, not `false` — an operator's manual pause stays in place.
		expect(successUpdate?.data).not.toHaveProperty('schedulePaused');
	});

	it('FIN-D4-04: SUCCESS with no errors passes null (not an empty array) to finishLog', async () => {
		setupHappyPathMocks();

		await service.triggerSync(CONNECTION_ID);

		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			{
				usersSynced: 1,
				groupsSynced: 1,
				rolesSynced: 1,
				usersSkippedCollision: 0,
				groupsDeactivated: 0,
				rolesDeactivated: 0,
			},
			null,
		);
	});

	it('API-SYNC-SVC-10: Orphan group deleted when no user references it', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchGroupsRawForUser.mockResolvedValue([]);
		identitySyncClient.fetchRolesRawForUser.mockResolvedValue([]);

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.deleteOrphanGroups).toHaveBeenCalledWith(CONNECTION_ID, new Set());
		expect(identityRepository.deleteOrphanRoles).toHaveBeenCalledWith(CONNECTION_ID, new Set());
	});

	it('API-SYNC-SVC-D5-01: orphan-deactivation counts are persisted via finishLog and returned in the DTO (Prompt 39 D5)', async () => {
		setupHappyPathMocks();
		identityRepository.deleteOrphanGroups.mockResolvedValue(3);
		identityRepository.deleteOrphanRoles.mockResolvedValue(2);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			'log-running',
			'SUCCESS',
			expect.objectContaining({ groupsDeactivated: 3, rolesDeactivated: 2 }),
			null,
		);
		expect(result.syncLog.groupsDeactivated).toBe(3);
		expect(result.syncLog.rolesDeactivated).toBe(2);
	});

	it('API-SYNC-SVC-D5-02: dry run persists 0 deactivation counts — orphan deletes are skipped (Prompt 39 D5)', async () => {
		setupHappyPathMocks();
		identityRepository.deleteOrphanGroups.mockResolvedValue(3);
		identityRepository.deleteOrphanRoles.mockResolvedValue(2);

		const result = await service.triggerSync(CONNECTION_ID, { dryRun: true });

		expect(identityRepository.deleteOrphanGroups).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanRoles).not.toHaveBeenCalled();
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			'log-running',
			'SUCCESS',
			expect.objectContaining({ groupsDeactivated: 0, rolesDeactivated: 0 }),
			expect.anything(),
		);
		expect(result.syncLog.groupsDeactivated).toBe(0);
		expect(result.syncLog.rolesDeactivated).toBe(0);
	});

	it('API-SYNC-SVC-11: errors capped at 100', async () => {
		setupHappyPathMocks();
		const manyBadUsers = Array.from({ length: 150 }, (_, i) =>
			validExternalUser({ id: `bad-${i}`, passwordHash: 'not-bcrypt' }),
		);
		identitySyncClient.fetchUsersRaw.mockResolvedValue(manyBadUsers);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.errors).toHaveLength(100);
		expect(result.syncLog.errors![99]).toEqual({
			phase: 'truncated',
			message: 'Additional errors truncated',
		});
	});

	it('API-SYNC-SVC-12: passwordHash never appears in errors JSON', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'leaky', passwordHash: 'not-bcrypt' }),
		]);
		syncLogService.finishLog.mockImplementation(async (_id, status, counters, errors) =>
			mockFinishedLog({
				status,
				errors: errors as SyncLog['errors'],
				usersSynced: counters.usersSynced,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);
		const serialized = JSON.stringify(result.syncLog.errors);

		expect(serialized).not.toContain(TEST_PASSWORD_HASH);
		expect(serialized).not.toContain('not-bcrypt');
	});

	it('API-SYNC-SVC-13: Validation-failed user id in snapshot → not deactivated', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'invalid-row', passwordHash: 'not-bcrypt' }),
		]);

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.deactivateUsersNotInExternalIds).toHaveBeenCalledWith(
			CONNECTION_ID,
			new Set(['invalid-row']),
		);
	});

	it('API-SYNC-SVC-14: Credentials decrypted once per run (spy decrypt)', async () => {
		setupHappyPathMocks();

		await service.triggerSync(CONNECTION_ID);

		expect(encryption.decrypt).toHaveBeenCalledTimes(1);
		expect(encryption.decrypt).toHaveBeenCalledWith('enc:creds');
	});

	it('API-SYNC-SVC-15: dryRun → no User rows created; usersSynced > 0', async () => {
		setupHappyPathMocks();

		const result = await service.triggerSync(CONNECTION_ID, { dryRun: true });

		expect(result.syncLog.usersSynced).toBeGreaterThan(0);
		expect(result.syncLog.dryRun).toBe(true);
		expect(identityRepository.upsertUser).not.toHaveBeenCalled();
		expect(identityRepository.upsertGroup).not.toHaveBeenCalled();
		expect(identityRepository.upsertRole).not.toHaveBeenCalled();
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: DRY_RUN_SUMMARY_PHASE,
					message: DRY_RUN_SUMMARY_MESSAGE,
				}),
			]),
		);
	});

	it('API-SYNC-SVC-16: dryRun → connection lastSyncAt unchanged', async () => {
		setupHappyPathMocks();
		const syncedConnection = {
			...baseConnection,
			lastSyncAt: new Date('2026-02-01T00:00:00.000Z'),
			lastSyncStatus: 'SUCCESS' as const,
		};
		prisma.apiConnection.findUnique.mockResolvedValue(syncedConnection);

		const result = await service.triggerSync(CONNECTION_ID, { dryRun: true });

		expect(result.connection.lastSyncAt).toBe('2026-02-01T00:00:00.000Z');
		expect(result.connection.lastSyncStatus).toBe('SUCCESS');
		expect(prisma.apiConnection.update).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-17: a username collision skips that user (and its group/role fetch) but the run succeeds', async () => {
		setupHappyPathMocks();
		identityRepository.upsertUser.mockRejectedValue(
			new UsernameCollisionError('ext-user-1', 'alice'),
		);

		await service.triggerSync(CONNECTION_ID);

		expect(identitySyncClient.fetchGroupsRawForUser).not.toHaveBeenCalled();
		expect(identitySyncClient.fetchRolesRawForUser).not.toHaveBeenCalled();
		// Prompt 37: a cross-connection collision is non-fatal — SUCCESS, counted, recorded as a distinct entry.
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			expect.objectContaining({ usersSynced: 0, usersSkippedCollision: 1 }),
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'username_collision',
					externalUserId: 'ext-user-1',
				}),
			]),
		);
	});

	it('MAS-COLL-FAILRUN: a collision under per-connection fail_run policy marks the run FAILED', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			usernameCollisionPolicy: 'fail_run',
		});
		identityRepository.upsertUser.mockRejectedValue(
			new UsernameCollisionError('ext-user-1', 'alice'),
		);

		await service.triggerSync(CONNECTION_ID);

		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.objectContaining({ usersSkippedCollision: 1 }),
			expect.anything(),
		);
	});

	it('MAS-COLL-INVALID: an invalid per-connection collision policy falls back to the global policy (§5.C)', async () => {
		setupHappyPathMocks();
		// Global policy fail_run; the stored override is garbage — the old blind cast would have
		// silently behaved like 'skip', the validated read must fall back to fail_run.
		const failRunService = new SyncService(
			prisma as never,
			identityRepository as unknown as ActiveIdentityStore,
			syncLogService as unknown as SyncLogService,
			identitySyncClient as unknown as IdentitySyncClientService,
			encryption,
			audit as never,
			oauthTokenService as never,
			fakeProxyDispatcher(),
			{
				usernameCollisionPolicy: () => 'fail_run',
				syncAllConcurrency: () => 1,
				syncSourceStaleFactor: () => 3,
			} as never,
		);
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			usernameCollisionPolicy: 'bogus-policy',
		});
		identityRepository.upsertUser.mockRejectedValue(
			new UsernameCollisionError('ext-user-1', 'alice'),
		);

		await failRunService.triggerSync(CONNECTION_ID);

		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.objectContaining({ usersSkippedCollision: 1 }),
			expect.anything(),
		);
	});

	it('API-SYNC-SVC-18: User count over limit → FAILED, no upserts', async () => {
		setupHappyPathMocks();
		identitySyncClient.getMaxUsersPerRun.mockReturnValue(2);
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'u1' }),
			validExternalUser({ id: 'u2' }),
			validExternalUser({ id: 'u3' }),
		]);
		syncLogService.finishLog.mockResolvedValue(
			mockFinishedLog({ status: 'FAILED', usersSynced: 0, groupsSynced: 0, rolesSynced: 0 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'user_limit' })]),
		);
		expect(identityRepository.upsertUser).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-19: getSyncStatus → syncInProgress true during real run', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			lastSyncStatus: 'IN_PROGRESS',
		});
		syncLogService.getLatestLogForConnection.mockResolvedValue(runningLog);
		syncLogService.getOpenRunningLog.mockResolvedValue({
			...runningLog,
			startedAt: new Date(),
		});

		const status = await service.getSyncStatus(CONNECTION_ID);

		expect(status.syncInProgress).toBe(true);
		expect(status.lastSyncStatus).toBe('IN_PROGRESS');
		expect(status.latestSyncLog).toEqual(expect.objectContaining({ id: runningLog.id }));
	});

	it('getSyncStatus throws NotFoundException for missing connection', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.getSyncStatus('missing')).rejects.toThrow(NotFoundException);
	});

	it('triggerSync throws NotFoundException for missing connection', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.triggerSync('missing')).rejects.toThrow(NotFoundException);
	});

	it('group and role upsert collisions append errors without aborting run', async () => {
		setupHappyPathMocks();
		identityRepository.upsertGroup.mockRejectedValue(
			new GroupNameCollisionError('g1', 'Engineering'),
		);
		identityRepository.upsertRole.mockRejectedValue(new RoleNameCollisionError('r1', 'Admin'));

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'upsert_group', externalGroupId: 'g1' }),
				expect.objectContaining({ phase: 'upsert_role', externalRoleId: 'r1' }),
			]),
		);
	});

	it('user limit via ExternalApiValidationError maps to user_limit phase', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new ExternalApiValidationError('User count exceeds limit of 2'),
		);
		syncLogService.finishLog.mockResolvedValue(
			mockFinishedLog({ status: 'FAILED', usersSynced: 0, groupsSynced: 0, rolesSynced: 0 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'user_limit' })]),
		);
	});

	it('API-SYNC-SVC-20: Groups fetch failure per user → SUCCESS with fetch_groups error', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchGroupsRawForUser.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 503', {
				statusCode: 503,
				reachable: true,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'fetch_groups', externalUserId: 'ext-user-1' }),
			]),
		);
		expect(identityRepository.upsertUser).toHaveBeenCalled();
	});

	it('API-SYNC-SVC-21: Roles fetch failure per user → SUCCESS with fetch_roles error', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchRolesRawForUser.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 502', {
				statusCode: 502,
				reachable: true,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'fetch_roles', externalUserId: 'ext-user-1' }),
			]),
		);
	});

	it('API-SYNC-SVC-22: User upsert failure skips groups and roles for that user', async () => {
		setupHappyPathMocks();
		identityRepository.upsertUser.mockRejectedValue(new Error('db write failed'));

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'upsert_user', externalUserId: 'ext-user-1' }),
			]),
		);
		expect(identityRepository.replaceUserGroups).not.toHaveBeenCalled();
		expect(identityRepository.replaceUserRoles).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-23: Decrypt credentials failure → FAILED with decrypt_credentials phase', async () => {
		setupHappyPathMocks();
		encryption.decrypt.mockImplementation(() => {
			throw new Error('decrypt failed');
		});
		syncLogService.finishLog.mockResolvedValue(
			mockFinishedLog({ status: 'FAILED', usersSynced: 0, groupsSynced: 0, rolesSynced: 0 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'decrypt_credentials' })]),
		);
	});

	it('API-SYNC-SVC-24: Reactivated user from API with active:true after deactivation', async () => {
		setupHappyPathMocks();
		identityRepository.upsertUser.mockResolvedValue({ id: 'local-user-1', active: true });

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.upsertUser).toHaveBeenCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ active: true }),
		);
	});

	it('API-SYNC-SVC-25: active:false external user upserted with active false', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([validExternalUser({ active: false })]);

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.upsertUser).toHaveBeenCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ active: false }),
		);
	});

	it('API-SYNC-SVC-26: triggerSync returns connection lastSyncStatus SUCCESS on happy path', async () => {
		setupHappyPathMocks();

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.connection.lastSyncStatus).toBe('SUCCESS');
		expect(result.connection.lastSyncAt).toEqual(expect.any(String));
	});

	it('API-SYNC-SVC-27: dryRun does not call deactivateUsersNotInExternalIds', async () => {
		setupHappyPathMocks();

		await service.triggerSync(CONNECTION_ID, { dryRun: true });

		expect(identityRepository.deactivateUsersNotInExternalIds).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanGroups).not.toHaveBeenCalled();
		expect(identityRepository.deleteOrphanRoles).not.toHaveBeenCalled();
	});

	it('API-SYNC-SVC-28: listSyncLogs delegates to syncLogService', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(baseConnection);
		syncLogService.listLogsForConnection.mockResolvedValue([mockFinishedLog()]);

		const result = await service.listSyncLogs(CONNECTION_ID, 10);

		expect(syncLogService.listLogsForConnection).toHaveBeenCalledWith(CONNECTION_ID, 10, undefined);
		expect(result.syncLogs).toHaveLength(1);
	});

	it('API-SYNC-INT-CONTRACT-01: full custom contract (nested field map) upserts mapped users', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			apiContractConfig: {
				userFieldMap: { id: 'uid', username: 'profile.login', passwordHash: 'creds.hash' },
			},
		});
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			{
				uid: 'ext-user-1',
				profile: { login: 'mapped-alice' },
				creds: { hash: TEST_PASSWORD_HASH },
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(identityRepository.upsertUser).toHaveBeenCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ externalId: 'ext-user-1', username: 'mapped-alice' }),
		);
	});

	it('API-CONTRACT-E1-01: embedded memberships read from user row (no group/role HTTP call)', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			apiContractConfig: {
				membershipSource: {
					groups: { mode: 'embedded', embeddedPath: 'groups' },
					roles: { mode: 'embedded', embeddedPath: 'roles' },
				},
			},
		});
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({
				groups: [{ id: 'g1', name: 'Engineering' }],
				roles: [{ id: 'r1', name: 'Admin' }],
			}),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.groupsSynced).toBe(1);
		expect(result.syncLog.rolesSynced).toBe(1);
		expect(identitySyncClient.fetchGroupsRawForUser).not.toHaveBeenCalled();
		expect(identitySyncClient.fetchRolesRawForUser).not.toHaveBeenCalled();
		expect(identityRepository.upsertGroup).toHaveBeenCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ id: 'g1' }),
		);
	});

	it('API-CONTRACT-E5-01: onRowError=skip keeps valid rows (default) ', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser(),
			validExternalUser({ id: 'ext-user-2', username: 'bad', passwordHash: 'plaintext' }),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.usersSynced).toBe(1);
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			expect.any(Object),
			expect.arrayContaining([
				expect.objectContaining({ phase: 'parse_users', externalUserId: 'ext-user-2' }),
			]),
		);
	});

	it('API-CONTRACT-E5-02: onRowError=fail aborts the whole run on first invalid row', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			apiContractConfig: { onRowError: 'fail' },
		});
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'ext-user-2', username: 'bad', passwordHash: 'plaintext' }),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
	});

	it('API-CONTRACT-E1-02: embedded path missing the array → 0 memberships, no error', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			apiContractConfig: {
				membershipSource: {
					groups: { mode: 'embedded', embeddedPath: 'groups' },
					roles: { mode: 'embedded', embeddedPath: 'roles' },
				},
			},
		});
		identitySyncClient.fetchUsersRaw.mockResolvedValue([validExternalUser()]); // no groups/roles keys

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.groupsSynced).toBe(0);
		expect(result.syncLog.rolesSynced).toBe(0);
		expect(identityRepository.upsertGroup).not.toHaveBeenCalled();
	});

	it('API-CONTRACT-E1-03: mixed embedded groups + endpoint roles', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			apiContractConfig: {
				membershipSource: { groups: { mode: 'embedded', embeddedPath: 'groups' } },
			},
		});
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ groups: [{ id: 'g1', name: 'Eng' }] }),
		]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(identitySyncClient.fetchGroupsRawForUser).not.toHaveBeenCalled(); // embedded
		expect(identitySyncClient.fetchRolesRawForUser).toHaveBeenCalled(); // endpoint
	});

	it('EDGE: invalid group row is recorded (skip) without aborting the run', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchGroupsRawForUser.mockResolvedValue([{ id: 'g1' }]); // missing name

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'upsert_group' })]),
		);
	});

	it('EDGE: endpoint membership fetch is bounded-parallel across multiple users', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			validExternalUser({ id: 'u1' }),
			validExternalUser({ id: 'u2', username: 'bob' }),
			validExternalUser({ id: 'u3', username: 'carol' }),
		]);
		identityRepository.upsertUser
			.mockResolvedValueOnce({ id: 'local-1' })
			.mockResolvedValueOnce({ id: 'local-2' })
			.mockResolvedValueOnce({ id: 'local-3' });

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(result.syncLog.usersSynced).toBe(3);
		expect(identitySyncClient.fetchGroupsRawForUser).toHaveBeenCalledTimes(3);
		expect(identitySyncClient.getMembershipFetchConcurrency).toHaveBeenCalled();
	});

	const oauthConnection = {
		...{
			id: CONNECTION_ID,
			name: 'OAuth API',
			baseUrl: 'https://identity.example.com',
			authType: 'OAUTH2_CLIENT_CREDENTIALS' as const,
			authCredentialsEncrypted: '',
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthClientSecretEncrypted: 'enc:secret',
			lastSyncAt: null,
			lastSyncStatus: 'NEVER' as const,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		},
	};

	it('OAUTH-SYNC-01: OAuth connection resolves a token then syncs', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.getAccessToken.mockResolvedValue('access-token-1');

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(oauthTokenService.getAccessToken).toHaveBeenCalled();
		expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledWith(
			oauthConnection.baseUrl,
			'access-token-1',
			expect.anything(),
			undefined,
		);
	});

	it('OAUTH-SYNC-02: 401 on users → refresh once and retry → success', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.getAccessToken
			.mockResolvedValueOnce('stale-token')
			.mockResolvedValueOnce('fresh-token');
		identitySyncClient.fetchUsersRaw
			.mockRejectedValueOnce(
				new IdentitySyncHttpError('HTTP 401', { statusCode: 401, reachable: true }),
			)
			.mockResolvedValueOnce([validExternalUser()]);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(oauthTokenService.getAccessToken).toHaveBeenCalledWith(oauthConnection, {
			forceRefresh: true,
		});
		expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-SYNC-03: second 401 after refresh → FAILED', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.getAccessToken.mockResolvedValue('token');
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new IdentitySyncHttpError('HTTP 401', { statusCode: 401, reachable: true }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-SYNC-04: token acquisition failure → FAILED with oauth error, no fetch', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		const { OAuthTokenError } = await import('@api/sync/services/oauth-token.service');
		oauthTokenService.getAccessToken.mockRejectedValue(
			new OAuthTokenError('token endpoint: HTTP 401 (invalid_client)', { statusCode: 401 }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(identitySyncClient.fetchUsersRaw).not.toHaveBeenCalled();
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'FAILED',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'oauth' })]),
		);
	});

	it('OAUTH-SYNC-05: BEARER 401 does NOT trigger an OAuth refresh/retry', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new IdentitySyncHttpError('HTTP 401', { statusCode: 401, reachable: true }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		expect(result.syncLog.status).toBe('FAILED');
		expect(oauthTokenService.getAccessToken).not.toHaveBeenCalled();
		expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledTimes(1);
	});

	it('OAUTH-SYNC-06: OAuth dry run resolves a token and reports counts without writes', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.getAccessToken.mockResolvedValue('AT');

		const result = await service.triggerSync(CONNECTION_ID, { dryRun: true });

		expect(result.syncLog.status).toBe('SUCCESS');
		expect(oauthTokenService.getAccessToken).toHaveBeenCalled();
		expect(identityRepository.upsertUser).not.toHaveBeenCalled();
	});

	it('OAUTH-SYNC-07: a 401 on a membership fetch (after users) is recorded, not OAuth-retried', async () => {
		setupHappyPathMocks();
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.getAccessToken.mockResolvedValue('AT');
		identitySyncClient.fetchGroupsRawForUser.mockRejectedValue(
			new IdentitySyncHttpError('HTTP 401', { statusCode: 401, reachable: true }),
		);

		const result = await service.triggerSync(CONNECTION_ID);

		// Users succeed; the membership 401 follows the normal row-error path (run still completes).
		expect(result.syncLog.status).toBe('SUCCESS');
		expect(oauthTokenService.getAccessToken).toHaveBeenCalledTimes(1);
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			expect.any(Object),
			expect.arrayContaining([expect.objectContaining({ phase: 'fetch_groups' })]),
		);
	});

	describe('isSyncInProgress (HARD-STALE-01: stale-run reclaim for the scheduler)', () => {
		it('returns true when a fresh open running log exists', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...baseConnection });
			syncLogService.getOpenRunningLog.mockResolvedValue({ id: 'log', startedAt: new Date() });
			await expect(service.isSyncInProgress(CONNECTION_ID)).resolves.toBe(true);
		});

		it('returns false for a STALE open running log (reclaimable, not "busy forever")', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...baseConnection });
			// stale threshold is 30 min; started 2 h ago.
			syncLogService.getOpenRunningLog.mockResolvedValue({
				id: 'log',
				startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
			});
			await expect(service.isSyncInProgress(CONNECTION_ID)).resolves.toBe(false);
		});

		it('falls back to lastSyncStatus when there is no open log', async () => {
			syncLogService.getOpenRunningLog.mockResolvedValue(null);
			prisma.apiConnection.findUnique.mockResolvedValue({
				...baseConnection,
				lastSyncStatus: 'IN_PROGRESS',
			});
			await expect(service.isSyncInProgress(CONNECTION_ID)).resolves.toBe(true);

			prisma.apiConnection.findUnique.mockResolvedValue({
				...baseConnection,
				lastSyncStatus: 'SUCCESS',
			});
			await expect(service.isSyncInProgress(CONNECTION_ID)).resolves.toBe(false);
		});

		it('returns false when the connection no longer exists', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(null);
			await expect(service.isSyncInProgress(CONNECTION_ID)).resolves.toBe(false);
		});
	});

	describe('outbound proxy wiring', () => {
		const marker = { __dispatcher: true };
		const proxiedService = new SyncService(
			prisma as never,
			identityRepository as unknown as ActiveIdentityStore,
			syncLogService as unknown as SyncLogService,
			identitySyncClient as unknown as IdentitySyncClientService,
			encryption,
			audit as never,
			oauthTokenService as never,
			fakeProxyDispatcher({ proxied: true, dispatcher: marker }),
			{
				usernameCollisionPolicy: () => 'skip',
				syncAllConcurrency: () => 1,
				syncSourceStaleFactor: () => 3,
			} as never,
		);

		it('PROXY-WIRE-01: a proxied sync passes a dispatcher to the users + membership fetches', async () => {
			setupHappyPathMocks();
			await proxiedService.triggerSync(CONNECTION_ID);
			expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledWith(
				baseConnection.baseUrl,
				BEARER_TOKEN,
				expect.anything(),
				marker,
			);
			expect(identitySyncClient.fetchGroupsRawForUser).toHaveBeenCalledWith(
				baseConnection.baseUrl,
				BEARER_TOKEN,
				expect.anything(),
				expect.anything(),
				marker,
			);
		});

		it('PROXY-WIRE-01b: a non-proxied sync passes no dispatcher', async () => {
			setupHappyPathMocks();
			await service.triggerSync(CONNECTION_ID);
			expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledWith(
				baseConnection.baseUrl,
				BEARER_TOKEN,
				expect.anything(),
				undefined,
			);
		});

		it('PROXY-WIRE-05: a scheduler-triggered sync also routes through the dispatcher', async () => {
			setupHappyPathMocks();
			await proxiedService.triggerSync(CONNECTION_ID, { triggerSource: 'scheduled' });
			expect(identitySyncClient.fetchUsersRaw).toHaveBeenCalledWith(
				baseConnection.baseUrl,
				BEARER_TOKEN,
				expect.anything(),
				marker,
			);
		});
	});

	describe('syncAll (Prompt 37, MAS-ALL)', () => {
		const log = (over: Record<string, unknown> = {}) => ({
			syncLog: {
				status: 'SUCCESS',
				usersSynced: 0,
				groupsSynced: 0,
				rolesSynced: 0,
				usersSkippedCollision: 0,
				...over,
			},
			connection: {},
		});

		it('MAS-ALL-07: an empty eligible set returns an empty summary', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([]);
			const res = await service.syncAll({});
			expect(res.results).toEqual([]);
			expect(res.totals.connections).toBe(0);
		});

		it('MAS-ALL-FILTER: only included non-local connections, in createdAt order (deterministic winner)', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([]);
			await service.syncAll({});
			const args = prisma.apiConnection.findMany.mock.calls[0][0];
			expect(args.where).toEqual({ isLocalDirectory: false, includeInSyncAll: true });
			expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
		});

		it('MAS-ALL-01/02: aggregates per-connection results in createdAt order and isolates failures', async () => {
			prisma.apiConnection.findMany
				.mockResolvedValueOnce([
					{ id: 'c1', name: 'A' },
					{ id: 'c2', name: 'B' },
				])
				.mockResolvedValueOnce([]); // excluded query

			jest.spyOn(service, 'isSyncInProgress').mockResolvedValue(false);
			const trigger = jest
				.spyOn(service, 'triggerSync')
				.mockResolvedValueOnce(log({ usersSynced: 5, usersSkippedCollision: 1 }) as never)
				.mockRejectedValueOnce(new Error('boom'));

			const res = await service.syncAll({ adminId: 'admin-1' });

			expect(trigger).toHaveBeenCalledWith(
				'c1',
				expect.objectContaining({ triggerSource: 'manual_all' }),
			);
			expect(res.results[0]).toMatchObject({
				connectionId: 'c1',
				status: 'succeeded',
				usersSynced: 5,
				usersSkippedCollision: 1,
			});
			expect(res.results[1]).toMatchObject({ connectionId: 'c2', status: 'failed' });
			expect(res.totals).toMatchObject({ connections: 2, succeeded: 1, failed: 1 });
		});

		it('MAS-ALL-03: an in-progress connection is reported skipped, not double-run', async () => {
			prisma.apiConnection.findMany
				.mockResolvedValueOnce([{ id: 'c1', name: 'A' }])
				.mockResolvedValueOnce([]); // excluded query
			jest.spyOn(service, 'isSyncInProgress').mockResolvedValue(true);
			const trigger = jest.spyOn(service, 'triggerSync');
			const res = await service.syncAll({});
			expect(res.results[0].status).toBe('skipped_in_progress');
			expect(trigger).not.toHaveBeenCalled();
		});

		it('MAS-ALL-EXCLUDED: includeInSyncAll:false non-local sources are emitted as excluded results and counted (§B3)', async () => {
			prisma.apiConnection.findMany
				.mockResolvedValueOnce([{ id: 'c1', name: 'A' }]) // included
				.mockResolvedValueOnce([{ id: 'c9', name: 'Opted-out' }]); // excluded
			jest.spyOn(service, 'isSyncInProgress').mockResolvedValue(false);
			const trigger = jest
				.spyOn(service, 'triggerSync')
				.mockResolvedValue(log({ usersSynced: 3 }) as never);

			const res = await service.syncAll({});

			// The excluded source is never contacted, only reported.
			expect(trigger).toHaveBeenCalledTimes(1);
			expect(trigger).toHaveBeenCalledWith('c1', expect.anything());
			const excluded = res.results.find((r) => r.connectionId === 'c9');
			expect(excluded).toMatchObject({ status: 'excluded', name: 'Opted-out', usersSynced: 0 });
			expect(res.totals).toMatchObject({ connections: 2, succeeded: 1, excluded: 1 });
		});

		describe('MAS-ALL-B3: concurrency clamp (cross-source collision determinism)', () => {
			function makeParallelService(configured: number) {
				return new SyncService(
					prisma as never,
					identityRepository as unknown as ActiveIdentityStore,
					syncLogService as unknown as SyncLogService,
					identitySyncClient as unknown as IdentitySyncClientService,
					encryption,
					audit as never,
					oauthTokenService as never,
					fakeProxyDispatcher(),
					{
						usernameCollisionPolicy: () => 'skip',
						syncAllConcurrency: () => configured,
						syncSourceStaleFactor: () => 3,
					} as never,
				);
			}

			async function maxOverlap(
				svc: SyncService,
				conns: Array<Record<string, unknown>>,
			): Promise<number> {
				prisma.apiConnection.findMany.mockResolvedValueOnce(conns).mockResolvedValueOnce([]);
				jest.spyOn(svc, 'isSyncInProgress').mockResolvedValue(false);
				let active = 0;
				let max = 0;
				jest.spyOn(svc, 'triggerSync').mockImplementation(async () => {
					active += 1;
					max = Math.max(max, active);
					await new Promise((r) => setTimeout(r, 5));
					active -= 1;
					return log() as never;
				});
				await svc.syncAll({});
				return max;
			}

			it('MAS-ALL-B3-01: SYNC_ALL_CONCURRENCY>1 is clamped to sequential when any source uses the skip policy', async () => {
				const svc = makeParallelService(4);
				// c1 has no per-connection override → falls back to the global 'skip' policy → clamp.
				const overlap = await maxOverlap(svc, [
					{ id: 'c1', name: 'A', usernameCollisionPolicy: null },
					{ id: 'c2', name: 'B', usernameCollisionPolicy: 'fail_run' },
					{ id: 'c3', name: 'C', usernameCollisionPolicy: 'fail_run' },
				]);
				expect(overlap).toBe(1);
			});

			it('MAS-ALL-B3-02: configured parallelism is honoured when every source is fail_run', async () => {
				const svc = makeParallelService(4);
				const overlap = await maxOverlap(svc, [
					{ id: 'c1', name: 'A', usernameCollisionPolicy: 'fail_run' },
					{ id: 'c2', name: 'B', usernameCollisionPolicy: 'fail_run' },
					{ id: 'c3', name: 'C', usernameCollisionPolicy: 'fail_run' },
				]);
				expect(overlap).toBeGreaterThan(1);
			});
		});

		it('MAS-ALL-05: dry-run does not check in-progress and passes dryRun through', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([{ id: 'c1', name: 'A' }]);
			const inProgress = jest.spyOn(service, 'isSyncInProgress');
			jest.spyOn(service, 'triggerSync').mockResolvedValue(log() as never);
			const res = await service.syncAll({ dryRun: true });
			expect(res.dryRun).toBe(true);
			expect(inProgress).not.toHaveBeenCalled();
		});
	});
});
