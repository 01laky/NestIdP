import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import {
	ADMIN_CSRF_HEADER_NAME,
	API_CONNECTIONS_API_PATH,
	DEFAULT_PASSWORD_HASH_ALGORITHM,
	SYNC_API_PATH,
} from '@nestidp/shared';
import { AdminModule } from '../admin/admin.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { LoginRateLimiterService } from '../admin-auth/login-rate-limiter.service';
import { IdentityModule } from '../identity/identity.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	TEST_PASSWORD_HASH,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';

jest.setTimeout(60_000);

type MockIdentityUser = {
	id: string;
	username: string;
	email?: string;
	displayName?: string;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
	groups?: { id: string; name: string }[];
	roles?: { id: string; name: string }[];
};

type MockIdentityApiOptions = {
	usersStatus?: number;
	groupsStatus?: number;
	rolesStatus?: number;
};

function mockIdentityApiResponses(
	users: MockIdentityUser[],
	options: MockIdentityApiOptions = {},
): jest.SpiedFunction<typeof fetch> {
	const usersById = new Map(users.map((user) => [user.id, user]));

	return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
		const urlStr =
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

		if (urlStr.endsWith('/users')) {
			if (options.usersStatus != null && options.usersStatus !== 200) {
				return { status: options.usersStatus, json: async () => null } as Response;
			}
			const body = users.map((entry) => {
				const { groups, roles, ...user } = entry;
				void groups;
				void roles;
				return user;
			});
			return { status: 200, json: async () => body } as Response;
		}

		const groupsMatch = urlStr.match(/\/users\/([^/]+)\/groups$/);
		if (groupsMatch) {
			if (options.groupsStatus != null && options.groupsStatus !== 200) {
				return { status: options.groupsStatus, json: async () => null } as Response;
			}
			const userId = decodeURIComponent(groupsMatch[1]!);
			const user = usersById.get(userId);
			return {
				status: 200,
				json: async () => user?.groups ?? [],
			} as Response;
		}

		const rolesMatch = urlStr.match(/\/users\/([^/]+)\/roles$/);
		if (rolesMatch) {
			if (options.rolesStatus != null && options.rolesStatus !== 200) {
				return { status: options.rolesStatus, json: async () => null } as Response;
			}
			const userId = decodeURIComponent(rolesMatch[1]!);
			const user = usersById.get(userId);
			return {
				status: 200,
				json: async () => user?.roles ?? [],
			} as Response;
		}

		return { status: 404, json: async () => null } as Response;
	});
}

describe('sync integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

	const sampleExternalUser: MockIdentityUser = {
		id: 'ext-user-1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice Example',
		passwordHash: TEST_PASSWORD_HASH,
		passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		active: true,
		groups: [{ id: 'grp-1', name: 'Engineering' }],
		roles: [{ id: 'role-1', name: 'Admin' }],
	};

	async function loginAgent(agent: ReturnType<typeof request.agent>) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return login.body.csrfToken as string;
	}

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}

	function triggerSync(
		agent: ReturnType<typeof request.agent>,
		csrf: string,
		connectionId: string,
		body: { dryRun?: boolean } = {},
	) {
		return agent.post(`${SYNC_API_PATH}/${connectionId}`).set(csrfHeader(csrf)).send(body);
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sync-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');

		const prismaService = new PrismaService({
			datasources: { db: { url: databaseUrl } },
		});

		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [
						() => ({
							DATABASE_PROVIDER: 'sqlite',
							DATABASE_URL: databaseUrl,
							SESSION_SECRET: 'test-session-secret-min-16',
							ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				PrismaModule,
				EncryptionModule,
				IdentityModule,
				AdminAuthModule,
				AdminModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();

		prisma = app.get(PrismaService);
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
	});

	beforeEach(async () => {
		app.get(LoginRateLimiterService).clear();
		await prisma.user.deleteMany();
		await prisma.syncLog.deleteMany();
		await prisma.group.deleteMany();
		await prisma.role.deleteMany();
		await prisma.apiConnection.deleteMany();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	afterAll(async () => {
		await app.close();
		const filePath = databaseUrl.replace(/^file:/, '');
		try {
			unlinkSync(filePath);
		} catch {
			// ignore
		}
	});

	it('API-SYNC-INT-01: Happy path sync → users, groups, roles in DB, SUCCESS', async () => {
		const connection = await createTestApiConnection(prisma, {
			bearerToken: 'sync-bearer-token',
		});
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);

		expect(response.body.syncLog).toMatchObject({
			status: 'SUCCESS',
			usersSynced: 1,
			groupsSynced: 1,
			rolesSynced: 1,
			dryRun: false,
		});
		expect(response.body.connection).toMatchObject({
			id: connection.id,
			lastSyncStatus: 'SUCCESS',
		});
		expect(response.body.connection.lastSyncAt).not.toBeNull();

		expect(await prisma.user.count()).toBe(1);
		expect(await prisma.group.count()).toBe(1);
		expect(await prisma.role.count()).toBe(1);

		const user = await prisma.user.findFirst({ where: { apiConnectionId: connection.id } });
		expect(user).toMatchObject({
			externalId: 'ext-user-1',
			username: 'alice',
			passwordHash: TEST_PASSWORD_HASH,
			active: true,
		});
	});

	it('API-SYNC-INT-02: Unauthenticated POST trigger → 401', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });

		await request(app.getHttpServer() as App)
			.post(`${SYNC_API_PATH}/${connection.id}`)
			.send({})
			.expect(401);
	});

	it('API-SYNC-INT-03: POST trigger without CSRF → 403', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.post(`${SYNC_API_PATH}/${connection.id}`).send({}).expect(403);
	});

	it('API-SYNC-INT-04: POST trigger unknown connection → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, 'c1234567890123456789012345').expect(404);

		expect(response.body).toMatchObject({
			statusCode: 404,
			message: expect.any(String),
		});
	});

	it('API-SYNC-INT-05: External API users 401 → HTTP 200, syncLog FAILED', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser], { usersStatus: 401 });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);

		expect(response.body.syncLog).toMatchObject({
			status: 'FAILED',
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
		});
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'fetch_users',
					httpStatus: 401,
				}),
			]),
		);
		expect(response.body.connection.lastSyncStatus).toBe('FAILED');
		expect(await prisma.user.count()).toBe(0);
	});

	it('API-SYNC-INT-06: GET status after successful sync → SUCCESS, not in progress', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await triggerSync(agent, csrf, connection.id).expect(200);

		const status = await agent.get(`${SYNC_API_PATH}/${connection.id}/status`).expect(200);

		expect(status.body).toMatchObject({
			connectionId: connection.id,
			lastSyncStatus: 'SUCCESS',
			syncInProgress: false,
		});
		expect(status.body.lastSyncAt).not.toBeNull();
		expect(status.body.latestSyncLog).toMatchObject({
			status: 'SUCCESS',
			usersSynced: 1,
		});
	});

	it('API-SYNC-INT-07: GET logs list after sync → contains latest log', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const triggered = await triggerSync(agent, csrf, connection.id).expect(200);
		const syncLogId = triggered.body.syncLog.id as string;

		const list = await agent.get(`${SYNC_API_PATH}/${connection.id}/logs`).expect(200);

		expect(list.body.syncLogs).toHaveLength(1);
		expect(list.body.syncLogs[0]).toMatchObject({
			id: syncLogId,
			status: 'SUCCESS',
			usersSynced: 1,
		});
	});

	it('API-SYNC-INT-08: GET logs/:syncLogId → same log as trigger response', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const triggered = await triggerSync(agent, csrf, connection.id).expect(200);
		const syncLogId = triggered.body.syncLog.id as string;

		const fetched = await agent.get(`${SYNC_API_PATH}/logs/${syncLogId}`).expect(200);

		expect(fetched.body.syncLog).toMatchObject({
			id: syncLogId,
			apiConnectionId: connection.id,
			status: 'SUCCESS',
			usersSynced: 1,
			groupsSynced: 1,
			rolesSynced: 1,
		});
	});

	it('API-SYNC-INT-09: dryRun=true → no User/Group/Role rows, log marked dryRun', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id, { dryRun: true }).expect(200);

		expect(response.body.syncLog).toMatchObject({
			status: 'SUCCESS',
			dryRun: true,
			usersSynced: 1,
			groupsSynced: 1,
			rolesSynced: 1,
		});
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ phase: 'dry_run_summary' })]),
		);

		expect(await prisma.user.count()).toBe(0);
		expect(await prisma.group.count()).toBe(0);
		expect(await prisma.role.count()).toBe(0);
	});

	it('API-SYNC-INT-10: dryRun → connection lastSyncAt and lastSyncStatus unchanged', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id, { dryRun: true }).expect(200);

		expect(response.body.connection).toMatchObject({
			id: connection.id,
			lastSyncStatus: 'NEVER',
			lastSyncAt: null,
		});

		const row = await prisma.apiConnection.findUnique({ where: { id: connection.id } });
		expect(row!.lastSyncStatus).toBe('NEVER');
		expect(row!.lastSyncAt).toBeNull();
	});

	it('API-SYNC-INT-11: Unauthenticated GET status → 401', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });

		await request(app.getHttpServer() as App)
			.get(`${SYNC_API_PATH}/${connection.id}/status`)
			.expect(401);
	});

	it('API-SYNC-INT-12: GET status unknown connection → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.get(`${SYNC_API_PATH}/c1234567890123456789012345/status`).expect(404);
	});

	it('API-SYNC-INT-13: GET logs list unknown connection → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.get(`${SYNC_API_PATH}/c1234567890123456789012345/logs`).expect(404);
	});

	it('API-SYNC-INT-14: GET logs/:syncLogId unknown → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.get(`${SYNC_API_PATH}/logs/c1234567890123456789012345`).expect(404);
	});

	it('API-SYNC-INT-15: POST trigger with extra field → 400 forbidNonWhitelisted', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(`${SYNC_API_PATH}/${connection.id}`)
			.set(csrfHeader(csrf))
			.send({ dryRun: false, force: true })
			.expect(400);
	});

	it('API-SYNC-INT-16: Sync fetch sends Authorization Bearer from encrypted credentials', async () => {
		const bearerToken = 'my-plaintext-sync-token';
		const connection = await createTestApiConnection(prisma, { bearerToken });
		const fetchMock = mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await triggerSync(agent, csrf, connection.id).expect(200);

		const usersCall = fetchMock.mock.calls.find(([url]) => {
			const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
			return urlStr.endsWith('/users');
		});
		expect(usersCall).toBeDefined();
		const init = usersCall![1] as RequestInit;
		expect(init.headers).toMatchObject({
			Authorization: `Bearer ${bearerToken}`,
		});
	});

	it('API-SYNC-INT-17: Second sync updates existing user password hash', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		const updatedHash = '$2b$12$updated.hash.value.here.xxxxxxxxxxxxxxxx';
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		mockIdentityApiResponses([sampleExternalUser]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		mockIdentityApiResponses([{ ...sampleExternalUser, passwordHash: updatedHash }]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		const user = await prisma.user.findFirst({ where: { externalId: 'ext-user-1' } });
		expect(user?.passwordHash).toBe(updatedHash);
	});

	it('API-SYNC-INT-18: Concurrent real sync → 409 when IN_PROGRESS with open log', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		await prisma.apiConnection.update({
			where: { id: connection.id },
			data: { lastSyncStatus: 'IN_PROGRESS' },
		});
		await prisma.syncLog.create({
			data: {
				apiConnectionId: connection.id,
				status: 'RUNNING',
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(409);
		expect(response.body.message).toContain('Sync already in progress');
	});

	it('API-SYNC-INT-19: GET /api/admin counts reflect synced entities', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await triggerSync(agent, csrf, connection.id).expect(200);

		const admin = await agent.get('/api/admin').expect(200);
		expect(admin.body.counts).toMatchObject({
			users: 1,
			groups: 1,
			roles: 1,
			apiConnections: 1,
		});
	});

	it('API-SYNC-INT-20: Response JSON never contains passwordHash or bearer token', async () => {
		const bearerToken = 'super-secret-bearer-token-value';
		const connection = await createTestApiConnection(prisma, { bearerToken });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		const body = JSON.stringify(response.body);
		expect(body).not.toContain(bearerToken);
		expect(body).not.toContain(TEST_PASSWORD_HASH);
		expect(response.body.connection).not.toHaveProperty('authCredentialsEncrypted');
	});

	it('API-SYNC-INT-21: DELETE api-connection with synced User → 409', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await triggerSync(agent, csrf, connection.id).expect(200);

		await agent
			.delete(`${API_CONNECTIONS_API_PATH}/${connection.id}`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-SYNC-INT-22: User removed from external API → deactivated locally', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		mockIdentityApiResponses([sampleExternalUser]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		mockIdentityApiResponses([]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		const user = await prisma.user.findFirst({ where: { externalId: 'ext-user-1' } });
		expect(user?.active).toBe(false);
		expect(await prisma.userGroup.count()).toBe(0);
	});

	it('API-SYNC-INT-23: Invalid user row → SUCCESS with errors, valid user still synced', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([
			{
				...sampleExternalUser,
				id: 'bad-user',
				passwordHash: 'not-a-bcrypt-hash',
			},
			sampleExternalUser,
		]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.status).toBe('SUCCESS');
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'parse_users', externalUserId: 'bad-user' }),
			]),
		);
		expect(await prisma.user.count()).toBe(1);
	});

	it('API-SYNC-INT-24: Oversized users array → FAILED with user_limit, HTTP 200', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		const oversized = Array.from({ length: 10_001 }, (_, i) => ({
			...sampleExternalUser,
			id: `ext-${i}`,
			username: `user-${i}`,
		}));
		mockIdentityApiResponses(oversized);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.status).toBe('FAILED');
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ phase: 'user_limit' })]),
		);
	});

	it('API-SYNC-INT-25: Tampered encrypted credentials → FAILED decrypt, HTTP 200', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		await prisma.apiConnection.update({
			where: { id: connection.id },
			data: { authCredentialsEncrypted: 'v1:invalid-ciphertext-data' },
		});

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.status).toBe('FAILED');
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ phase: 'decrypt_credentials' })]),
		);
	});

	it('API-SYNC-INT-26: Groups fetch failure → SUCCESS with fetch_groups error', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser], { groupsStatus: 503 });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.status).toBe('SUCCESS');
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'fetch_groups', externalUserId: 'ext-user-1' }),
			]),
		);
		expect(await prisma.user.count()).toBe(1);
	});

	it('API-SYNC-INT-27: Unauthenticated GET logs list → 401', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		await request(app.getHttpServer() as App)
			.get(`${SYNC_API_PATH}/${connection.id}/logs`)
			.expect(401);
	});

	it('API-SYNC-INT-28: GET logs limit query clamped to max 100', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		for (let i = 0; i < 5; i += 1) {
			await prisma.syncLog.create({
				data: {
					apiConnectionId: connection.id,
					status: 'SUCCESS',
					finishedAt: new Date(Date.now() - i * 1000),
				},
			});
		}

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const list = await agent.get(`${SYNC_API_PATH}/${connection.id}/logs?limit=500`).expect(200);
		expect(list.body.syncLogs.length).toBeLessThanOrEqual(100);
	});

	it('API-SYNC-INT-29: Invalid connectionId on trigger → 400 ParseCuidPipe', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await triggerSync(agent, csrf, 'not-a-cuid').expect(400);
	});

	it('API-SYNC-INT-30: dryRun does not block subsequent real sync', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await triggerSync(agent, csrf, connection.id, { dryRun: true }).expect(200);
		await triggerSync(agent, csrf, connection.id).expect(200);

		expect(await prisma.user.count()).toBe(1);
	});

	it('API-SYNC-INT-31: Empty users snapshot deactivates all previously synced users', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		mockIdentityApiResponses([sampleExternalUser]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		mockIdentityApiResponses([]);
		await triggerSync(agent, csrf, connection.id).expect(200);

		const users = await prisma.user.findMany({ where: { apiConnectionId: connection.id } });
		expect(users.every((u) => u.active === false)).toBe(true);
	});

	it('API-SYNC-INT-32: Happy path creates UserGroup and UserRole join rows', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await triggerSync(agent, csrf, connection.id).expect(200);

		expect(await prisma.userGroup.count()).toBe(1);
		expect(await prisma.userRole.count()).toBe(1);
	});

	it('API-SYNC-INT-33: syncLog durationMs populated after finished run', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.durationMs).toEqual(expect.any(Number));
		expect(response.body.syncLog.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('API-SYNC-INT-34: active:false user from API is stored inactive with memberships', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([{ ...sampleExternalUser, active: false }]);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await triggerSync(agent, csrf, connection.id).expect(200);

		const user = await prisma.user.findFirst({ where: { externalId: 'ext-user-1' } });
		expect(user?.active).toBe(false);
		expect(await prisma.userGroup.count()).toBe(1);
	});

	it('API-SYNC-INT-35: Roles fetch failure → SUCCESS with fetch_roles error', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'token' });
		mockIdentityApiResponses([sampleExternalUser], { rolesStatus: 502 });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await triggerSync(agent, csrf, connection.id).expect(200);
		expect(response.body.syncLog.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'fetch_roles', externalUserId: 'ext-user-1' }),
			]),
		);
	});
});
