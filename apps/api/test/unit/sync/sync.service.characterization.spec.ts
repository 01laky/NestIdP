import type { SyncLog } from '@prisma/client';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';
import { UsernameCollisionError } from '@api/identity/identity.repository';
import { ActiveIdentityStore } from '@api/identity/store/active-identity-store';
import { IdentitySyncClientService } from '@api/sync/services/identity-sync-client.service';
import { IdentitySyncHttpError } from '@api/sync/identity-sync.errors';
import { SyncLogService, capSyncErrors } from '@api/sync/services/sync-log.service';
import { SyncService } from '@api/sync/services/sync.service';
import { fakeProxyDispatcher } from '@test/support/proxy-dispatcher.mock';

/**
 * Prompt 38 §11: characterization (golden) tests for SyncService. Each scenario snapshots the
 * EXACT observable behaviour of the current implementation:
 *   - the ordered finishLog call args (status, counters, errors[]),
 *   - the ordered identity-store mutation sequence (method + args),
 *   - the audit recordSafe events,
 *   - the connection prisma updates and the returned DTO.
 * The .snap file is the committed golden fixture for the §6.8 decomposition — if a refactor
 * changes any snapshot, it changed behaviour.
 */

const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';
const CONNECTION_ID = 'c1234567890123456789012345';
const BEARER_TOKEN = 'plain-bearer-token';
const FIXED_STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const FIXED_FINISHED_AT = new Date('2026-01-01T00:00:01.000Z');

function externalUser(id: string, username: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		username,
		passwordHash: TEST_PASSWORD_HASH,
		passwordHashAlgorithm: 'bcrypt',
		active: true,
		...overrides,
	};
}

describe('SyncService characterization goldens (Prompt 38 §11)', () => {
	const prisma = {
		apiConnection: {
			findUnique: jest.fn(),
			update: jest.fn(),
			findMany: jest.fn(),
		},
		user: {
			findUnique: jest.fn(),
		},
	};

	// Scenario-overridable inner implementations; the outer tracked wrappers below record every
	// attempted mutation (incl. rejected ones) into `storeCalls` in call order.
	const storeImpl = {
		upsertUser: jest.fn(),
		upsertGroup: jest.fn(),
		upsertRole: jest.fn(),
		replaceUserGroups: jest.fn(),
		replaceUserRoles: jest.fn(),
		deactivateUsersNotInExternalIds: jest.fn(),
		deleteOrphanGroups: jest.fn(),
		deleteOrphanRoles: jest.fn(),
	};

	let storeCalls: Array<{ method: string; args: unknown[] }> = [];

	const identityRepository = Object.fromEntries(
		Object.entries(storeImpl).map(([method, impl]) => [
			method,
			jest.fn(async (...args: unknown[]) => {
				storeCalls.push({ method, args });
				return impl(...args);
			}),
		]),
	);

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
		getMaxUsersPerRun: jest.fn(),
		getStaleRunMinutes: jest.fn(),
		getMembershipFetchConcurrency: jest.fn(),
		getMaxGroupsPerUser: jest.fn(),
		getMaxRolesPerUser: jest.fn(),
	};

	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn(),
		decrypt: jest.fn(),
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
		createdAt: FIXED_STARTED_AT,
		updatedAt: FIXED_STARTED_AT,
	};

	function runningLogFor(connectionId: string) {
		return {
			id: `log-${connectionId}`,
			apiConnectionId: connectionId,
			startedAt: FIXED_STARTED_AT,
			finishedAt: null,
			status: 'RUNNING' as const,
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
			usersSkippedCollision: 0,
			errors: null,
			triggerSource: null,
		};
	}

	const ADMIN_OPTIONS = { adminId: 'admin-1', adminUsername: 'admin' };

	function setupBaseMocks() {
		prisma.apiConnection.findUnique.mockResolvedValue(baseConnection);
		prisma.apiConnection.findMany.mockResolvedValue([]);
		prisma.user.findUnique.mockResolvedValue(null);
		prisma.apiConnection.update.mockImplementation(
			async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
				...baseConnection,
				id: where.id,
				...data,
			}),
		);

		syncLogService.getOpenRunningLog.mockResolvedValue(null);
		syncLogService.createRunningLog.mockImplementation(async (connectionId: string) =>
			runningLogFor(connectionId),
		);
		// Echo the finish args back as the finished row (fixed timestamps) like the real service does.
		syncLogService.finishLog.mockImplementation(
			async (
				logId: string,
				status: SyncLog['status'],
				counters: {
					usersSynced: number;
					groupsSynced: number;
					rolesSynced: number;
					usersSkippedCollision?: number;
					groupsDeactivated?: number;
					rolesDeactivated?: number;
				},
				errors: unknown,
			) => ({
				...runningLogFor(CONNECTION_ID),
				id: logId,
				startedAt: FIXED_STARTED_AT,
				finishedAt: FIXED_FINISHED_AT,
				status,
				usersSynced: counters.usersSynced,
				groupsSynced: counters.groupsSynced,
				rolesSynced: counters.rolesSynced,
				usersSkippedCollision: counters.usersSkippedCollision ?? 0,
				groupsDeactivated: counters.groupsDeactivated ?? null,
				rolesDeactivated: counters.rolesDeactivated ?? null,
				errors: capSyncErrors(errors as never) as SyncLog['errors'],
			}),
		);

		encryption.decrypt.mockReturnValue(BEARER_TOKEN);

		identitySyncClient.getMaxUsersPerRun.mockReturnValue(10_000);
		identitySyncClient.getStaleRunMinutes.mockReturnValue(30);
		identitySyncClient.getMembershipFetchConcurrency.mockReturnValue(5);
		identitySyncClient.getMaxGroupsPerUser.mockReturnValue(1000);
		identitySyncClient.getMaxRolesPerUser.mockReturnValue(1000);

		// 2 users; per-user group/role memberships with one shared role (exercises upserted-set dedup).
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			externalUser('ext-u1', 'alice'),
			externalUser('ext-u2', 'bob'),
		]);
		identitySyncClient.fetchGroupsRawForUser.mockImplementation(
			async (_baseUrl: string, _token: string, externalUserId: string) =>
				externalUserId === 'ext-u1'
					? [{ id: 'g1', name: 'Engineering' }]
					: [{ id: 'g2', name: 'Sales' }],
		);
		identitySyncClient.fetchRolesRawForUser.mockImplementation(
			async (_baseUrl: string, _token: string, externalUserId: string) =>
				externalUserId === 'ext-u1'
					? [
							{ id: 'r1', name: 'Admin' },
							{ id: 'r2', name: 'Viewer' },
						]
					: [{ id: 'r2', name: 'Viewer' }],
		);

		storeImpl.upsertUser.mockImplementation(async (_connectionId, data) => ({
			id: `local-${(data as { externalId: string }).externalId}`,
		}));
		storeImpl.upsertGroup.mockImplementation(async (_connectionId, mapped) => ({
			id: `local-${(mapped as { id: string }).id}`,
		}));
		storeImpl.upsertRole.mockImplementation(async (_connectionId, mapped) => ({
			id: `local-${(mapped as { id: string }).id}`,
		}));
		storeImpl.replaceUserGroups.mockResolvedValue(undefined);
		storeImpl.replaceUserRoles.mockResolvedValue(undefined);
		storeImpl.deactivateUsersNotInExternalIds.mockResolvedValue(undefined);
		// The real store returns the orphan delete COUNT — persisted on SyncLog since Prompt 39 D5,
		// so real runs golden a nonzero count while dry runs and pre-phase-C failures golden 0.
		storeImpl.deleteOrphanGroups.mockResolvedValue(2);
		storeImpl.deleteOrphanRoles.mockResolvedValue(1);
	}

	function golden(extra: Record<string, unknown> = {}) {
		return {
			finishLogCalls: syncLogService.finishLog.mock.calls,
			storeCalls,
			auditEvents: audit.recordSafe.mock.calls.map((call) => call[0]),
			connectionUpdates: prisma.apiConnection.update.mock.calls.map((call) => call[0]),
			...extra,
		};
	}

	beforeEach(() => {
		jest.clearAllMocks();
		storeCalls = [];
		setupBaseMocks();
	});

	it('scenario 1: clean run — 2 users with group + role memberships', async () => {
		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('clean run');
	});

	it("scenario 2: username collision under 'skip' policy — counter, error entry, owner audit", async () => {
		storeImpl.upsertUser.mockImplementation(async (_connectionId, data) => {
			const user = data as { externalId: string; username: string };
			if (user.externalId === 'ext-u1') {
				throw new UsernameCollisionError('ext-u1', 'alice');
			}
			return { id: `local-${user.externalId}` };
		});
		prisma.user.findUnique.mockResolvedValue({
			apiConnectionId: 'conn-owner',
			apiConnection: { name: 'Other API', isLocalDirectory: false },
		});

		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('collision skip');
	});

	it("scenario 3: username collision under 'fail_run' policy — run FAILED", async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...baseConnection,
			usernameCollisionPolicy: 'fail_run',
		});
		storeImpl.upsertUser.mockImplementation(async (_connectionId, data) => {
			const user = data as { externalId: string };
			if (user.externalId === 'ext-u1') {
				throw new UsernameCollisionError('ext-u1', 'alice');
			}
			return { id: `local-${user.externalId}` };
		});
		prisma.user.findUnique.mockResolvedValue({
			apiConnectionId: 'conn-owner',
			apiConnection: { name: 'Other API', isLocalDirectory: false },
		});

		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('collision fail_run');
	});

	it('scenario 4: membership-phase failure — groups fetch rejects for one user', async () => {
		identitySyncClient.fetchGroupsRawForUser.mockImplementation(
			async (_baseUrl: string, _token: string, externalUserId: string) => {
				if (externalUserId === 'ext-u2') {
					throw new IdentitySyncHttpError('Identity API returned HTTP 503', {
						statusCode: 503,
						reachable: true,
					});
				}
				return [{ id: 'g1', name: 'Engineering' }];
			},
		);

		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('membership fetch failure');
	});

	it('scenario 5: deactivation snapshot — dropped bad-id row recorded, valid ids deactivation set', async () => {
		identitySyncClient.fetchUsersRaw.mockResolvedValue([
			externalUser('ext-u1', 'alice'),
			externalUser('ext-u2', 'bob'),
			externalUser(123 as never, 'badrow'),
		]);

		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('deactivation with dropped bad-id row');
	});

	it('scenario 6: dry run — no store mutations, dry-run summary entry', async () => {
		const result = await service.triggerSync(CONNECTION_ID, { ...ADMIN_OPTIONS, dryRun: true });

		expect(golden({ result })).toMatchSnapshot('dry run');
	});

	it('scenario 7: syncAll aggregate — success + failure + excluded connection', async () => {
		const connA = {
			...baseConnection,
			id: 'conn-a',
			name: 'Source A',
			baseUrl: 'https://a.example.com',
		};
		const connB = {
			...baseConnection,
			id: 'conn-b',
			name: 'Source B',
			baseUrl: 'https://b.example.com',
		};
		const connC = {
			...baseConnection,
			id: 'conn-c',
			name: 'Opted out',
			baseUrl: 'https://c.example.com',
		};
		prisma.apiConnection.findMany.mockImplementation(
			async ({ where }: { where: { includeInSyncAll: boolean } }) =>
				where.includeInSyncAll ? [connA, connB] : [connC],
		);
		prisma.apiConnection.findUnique.mockImplementation(
			async ({ where }: { where: { id: string } }) =>
				[connA, connB, connC].find((c) => c.id === where.id) ?? null,
		);
		// Source A: one clean user; Source B: users fetch fails.
		identitySyncClient.fetchUsersRaw.mockImplementation(async (baseUrl: string) => {
			if (baseUrl === connB.baseUrl) {
				throw new IdentitySyncHttpError('Identity API returned HTTP 503', {
					statusCode: 503,
					reachable: true,
				});
			}
			return [externalUser('ext-u1', 'alice')];
		});

		const response = await service.syncAll(ADMIN_OPTIONS);

		expect(golden({ response })).toMatchSnapshot('syncAll aggregate');
	});

	it('scenario 8: users fetch failure — FAILED log with fetch_users phase entry', async () => {
		identitySyncClient.fetchUsersRaw.mockRejectedValue(
			new IdentitySyncHttpError('Identity API returned HTTP 503', {
				statusCode: 503,
				reachable: true,
			}),
		);

		const result = await service.triggerSync(CONNECTION_ID, ADMIN_OPTIONS);

		expect(golden({ result })).toMatchSnapshot('fetch users failure');
	});
});
