import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SyncLog } from '@prisma/client';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';
import {
	GroupNameCollisionError,
	IdentityRepository,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '@api/identity/identity.repository';
import { ExternalApiValidationError } from '@api/sync/validators/external-api.validator';
import { IdentitySyncClientService } from '@api/sync/services/identity-sync-client.service';
import { IdentitySyncHttpError } from '@api/sync/identity-sync.errors';
import { DRY_RUN_SUMMARY_PHASE, DRY_RUN_SUMMARY_MESSAGE } from '@api/sync/mappers/sync.mapper';
import { SyncLogService, capSyncErrors } from '@api/sync/services/sync-log.service';
import { SyncService } from '@api/sync/services/sync.service';

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
		fetchGroupsForUser: jest.fn(),
		fetchRolesForUser: jest.fn(),
		getMaxUsersPerRun: jest.fn().mockReturnValue(10_000),
		getStaleRunMinutes: jest.fn().mockReturnValue(30),
	};

	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn(),
		decrypt: jest.fn().mockReturnValue(BEARER_TOKEN),
	};

	const audit = {
		recordSafe: jest.fn(),
	};

	const service = new SyncService(
		prisma as never,
		identityRepository as unknown as IdentityRepository,
		syncLogService as unknown as SyncLogService,
		identitySyncClient as unknown as IdentitySyncClientService,
		encryption,
		audit as never,
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
		errors: null,
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
		identitySyncClient.fetchGroupsForUser.mockResolvedValue([{ id: 'g1', name: 'Engineering' }]);
		identitySyncClient.fetchRolesForUser.mockResolvedValue([{ id: 'r1', name: 'Admin' }]);
		identityRepository.upsertUser.mockResolvedValue({ id: 'local-user-1' });
		identityRepository.upsertGroup.mockResolvedValue({ id: 'local-group-1' });
		identityRepository.upsertRole.mockResolvedValue({ id: 'local-role-1' });
		identityRepository.replaceUserGroups.mockResolvedValue(undefined);
		identityRepository.replaceUserRoles.mockResolvedValue(undefined);
		identityRepository.deactivateUsersNotInExternalIds.mockResolvedValue(undefined);
		identityRepository.deleteOrphanGroups.mockResolvedValue(undefined);
		identityRepository.deleteOrphanRoles.mockResolvedValue(undefined);
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
			{ usersSynced: 0, groupsSynced: 0, rolesSynced: 0 },
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
			},
		});
		expect(result.connection.lastSyncStatus).toBe('SUCCESS');
		expect(result.connection.lastSyncAt).toBe(finishedAt.toISOString());
	});

	it('API-SYNC-SVC-10: Orphan group deleted when no user references it', async () => {
		setupHappyPathMocks();
		identitySyncClient.fetchGroupsForUser.mockResolvedValue([]);
		identitySyncClient.fetchRolesForUser.mockResolvedValue([]);

		await service.triggerSync(CONNECTION_ID);

		expect(identityRepository.deleteOrphanGroups).toHaveBeenCalledWith(CONNECTION_ID, new Set());
		expect(identityRepository.deleteOrphanRoles).toHaveBeenCalledWith(CONNECTION_ID, new Set());
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
			phase: 'parse_users',
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

	it('API-SYNC-SVC-17: Upsert failure → skips groups/roles fetch for that user', async () => {
		setupHappyPathMocks();
		identityRepository.upsertUser.mockRejectedValue(
			new UsernameCollisionError('ext-user-1', 'alice'),
		);

		await service.triggerSync(CONNECTION_ID);

		expect(identitySyncClient.fetchGroupsForUser).not.toHaveBeenCalled();
		expect(identitySyncClient.fetchRolesForUser).not.toHaveBeenCalled();
		expect(syncLogService.finishLog).toHaveBeenCalledWith(
			runningLog.id,
			'SUCCESS',
			expect.objectContaining({ usersSynced: 0 }),
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'upsert_user',
					externalUserId: 'ext-user-1',
				}),
			]),
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
		identitySyncClient.fetchGroupsForUser.mockRejectedValue(
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
		identitySyncClient.fetchRolesForUser.mockRejectedValue(
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

		expect(syncLogService.listLogsForConnection).toHaveBeenCalledWith(CONNECTION_ID, 10);
		expect(result.syncLogs).toHaveLength(1);
	});
});
