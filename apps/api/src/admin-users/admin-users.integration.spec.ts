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
	ADMIN_SESSION_COOKIE_NAME,
	ADMIN_USERS_API_PATH,
} from '@nestidp/shared';
import { AdminModule } from '../admin/admin.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { LoginRateLimiterService } from '../admin-auth/login-rate-limiter.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { createTestAdminUserWithPassword } from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { AdminUserCreateRateLimiterService } from './admin-user-create-rate-limiter.service';
import { AdminUsersService } from './admin-users.service';
import { AdminSessionService } from '../admin-auth/admin-session.service';

function patchSessionCookiesForHttp(app: INestApplication): void {
	const sessionService = app.get(AdminSessionService);
	const sign = (
		sessionService as unknown as {
			sign: (payload: import('../admin-auth/admin-session.service').AdminSessionPayload) => string;
		}
	).sign.bind(sessionService);
	jest.spyOn(sessionService, 'setCookie').mockImplementation((res, payload) => {
		const token = sign(payload);
		res.cookie(ADMIN_SESSION_COOKIE_NAME, token, {
			httpOnly: true,
			secure: false,
			sameSite: 'lax',
			path: '/',
			maxAge: sessionService.getSessionTtlSeconds() * 1000,
		});
	});
}

jest.setTimeout(60_000);

describe('admin-users integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

	async function loginAgent(
		agent: ReturnType<typeof request.agent>,
		username = 'admin',
		password = adminPassword,
	) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username, password })
			.expect(200);
		return login.body.csrfToken as string;
	}

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-adm-usr-${randomUUID()}.db`);
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
		app.get(AdminUserCreateRateLimiterService).clear();
		await prisma.auditEvent.deleteMany();
		await prisma.adminUser.deleteMany({ where: { username: { not: 'admin' } } });
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

	it('API-ADM-USR-01: unauthenticated GET list → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(ADMIN_USERS_API_PATH)
			.expect(401);
	});

	it('API-ADM-USR-02: GET list includes bootstrap admin without password fields', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const list = await agent.get(ADMIN_USERS_API_PATH).expect(200);
		expect(list.body).toHaveLength(1);
		expect(list.body[0].username).toBe('admin');
		expect(list.body[0]).not.toHaveProperty('passwordHash');
		expect(JSON.stringify(list.body)).not.toContain(adminPassword);
	});

	it('API-ADM-USR-03: POST create admin user → 201 and appears in list', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'operator', password: 'OperatorPass1234' })
			.expect(201);

		expect(created.body.username).toBe('operator');
		expect(created.body).not.toHaveProperty('passwordHash');

		const list = await agent.get(ADMIN_USERS_API_PATH).expect(200);
		expect(list.body.some((row: { username: string }) => row.username === 'operator')).toBe(true);
	});

	it('API-ADM-USR-04: PATCH update password → 200', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const updated = await agent
			.patch(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.set(csrfHeader(csrf))
			.send({ password: 'NewHelperPass99' })
			.expect(200);

		expect(updated.body.id).toBe(helper.id);
		expect(updated.body.username).toBe('helper');
	});

	it('API-ADM-USR-05: DELETE other admin → 200', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent.delete(`${ADMIN_USERS_API_PATH}/${helper.id}`).set(csrfHeader(csrf)).expect(200);

		const list = await agent.get(ADMIN_USERS_API_PATH).expect(200);
		expect(list.body).toHaveLength(1);
		expect(list.body[0].username).toBe('admin');
	});

	it('API-ADM-USR-06: DELETE self while logged in → 409', async () => {
		const admin = await prisma.adminUser.findUnique({ where: { username: 'admin' } });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await agent
			.delete(`${ADMIN_USERS_API_PATH}/${admin!.id}`)
			.set(csrfHeader(csrf))
			.expect(409);

		expect(response.body.message).toContain('own admin account');
	});

	it('API-ADM-USR-07: cannot delete last admin account (service rule)', async () => {
		const sole = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
		const service = app.get(AdminUsersService);

		await expect(
			service.delete(sole!.id, { id: 'other-actor-id', username: 'other' }),
		).rejects.toMatchObject({
			response: { message: 'Cannot delete the last admin account' },
		});
	});

	it('API-ADM-USR-08: POST duplicate username → 409', async () => {
		await createTestAdminUserWithPassword(prisma, 'operator', 'OperatorPass1234');

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'operator', password: 'AnotherPass1234' })
			.expect(409);

		expect(response.body.message).toContain('already exists');
	});

	it('API-ADM-USR-09: POST without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent
			.post(ADMIN_USERS_API_PATH)
			.send({ username: 'noccsrf', password: 'NoCsrfPass1234' })
			.expect(403);
	});

	it('API-ADM-USR-10: PATCH without CSRF → 403', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent
			.patch(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.send({ password: 'NewHelperPass99' })
			.expect(403);
	});

	it('API-ADM-USR-11: DELETE without CSRF → 403', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.delete(`${ADMIN_USERS_API_PATH}/${helper.id}`).expect(403);
	});

	it('API-ADM-USR-14: DELETE unknown admin id → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.delete(`${ADMIN_USERS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.set(csrfHeader(csrf))
			.expect(404);
	});

	it('API-ADM-USR-15: PATCH unknown admin id → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.patch(`${ADMIN_USERS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.set(csrfHeader(csrf))
			.send({ password: 'NewHelperPass99' })
			.expect(404);
	});

	it('API-ADM-USR-16: POST empty body → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent.post(ADMIN_USERS_API_PATH).set(csrfHeader(csrf)).send({}).expect(400);
	});

	it('API-ADM-USR-17: POST extra fields → 400 forbidNonWhitelisted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'extra', password: 'ExtraPass12345', role: 'super' })
			.expect(400);
	});

	it('API-ADM-USR-18: POST whitespace-only username → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: '   ', password: 'ValidPass12345' })
			.expect(400);
	});

	it('API-ADM-USR-19: POST trims username before persist', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: '  trimmed  ', password: 'TrimmedPass123' })
			.expect(201);
		expect(created.body.username).toBe('trimmed');
	});

	it('API-ADM-USR-20: PATCH empty body → 400', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.patch(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(400);
	});

	it('API-ADM-USR-21: unauthenticated PATCH → 401', async () => {
		await request(app.getHttpServer() as App)
			.patch(`${ADMIN_USERS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.send({ password: 'NewHelperPass99' })
			.expect(401);
	});

	it('API-ADM-USR-22: unauthenticated DELETE → 401', async () => {
		await request(app.getHttpServer() as App)
			.delete(`${ADMIN_USERS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.expect(401);
	});

	it('API-ADM-USR-23: DELETE returns ok true and id', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const response = await agent
			.delete(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(response.body).toEqual({ ok: true, id: helper.id });
	});

	it('API-ADM-USR-24: create persists admin_user_created audit event', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'audited', password: 'AuditedPass123' })
			.expect(201);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const row = await prisma.auditEvent.findFirst({ where: { event: 'admin_user_created' } });
		expect(row).not.toBeNull();
		expect(row!.category).toBe('admin_config');
	});

	it('API-ADM-USR-25: delete persists admin_user_deleted audit event', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent.delete(`${ADMIN_USERS_API_PATH}/${helper.id}`).set(csrfHeader(csrf)).expect(200);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const row = await prisma.auditEvent.findFirst({ where: { event: 'admin_user_deleted' } });
		expect(row).not.toBeNull();
	});

	it('API-ADM-USR-26: GET list returns JSON array Content-Type', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const list = await agent.get(ADMIN_USERS_API_PATH).expect(200);
		expect(Array.isArray(list.body)).toBe(true);
		expect(list.headers['content-type']).toMatch(/application\/json/);
	});

	it('API-ADM-USR-27: PATCH invalid cuid id → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.patch(`${ADMIN_USERS_API_PATH}/not-a-cuid`)
			.set(csrfHeader(csrf))
			.send({ password: 'NewHelperPass99' })
			.expect(400);
	});

	it('API-ADM-USR-28: POST missing password → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'nopass' })
			.expect(400);
	});

	it('API-ADM-USR-29: created admin can login with new credentials', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'newlogin', password: 'NewLoginPass123' })
			.expect(201);

		const fresh = request.agent(app.getHttpServer() as App);
		await fresh
			.post('/api/admin/auth/login')
			.send({ username: 'newlogin', password: 'NewLoginPass123' })
			.expect(200);
	});

	it('API-ADM-USR-30: PATCH updates password allows login with new hash', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.patch(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.set(csrfHeader(csrf))
			.send({ password: 'PatchedPass1234' })
			.expect(200);

		const fresh = request.agent(app.getHttpServer() as App);
		await fresh
			.post('/api/admin/auth/login')
			.send({ username: 'helper', password: 'PatchedPass1234' })
			.expect(200);
	});
});

describe('admin-users create rate limit (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

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

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-adm-usr-rl-${randomUUID()}.db`);
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
							ADMIN_USER_CREATE_RATE_LIMIT_MAX: '2',
							ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS: '600000',
						}),
					],
				}),
				PrismaModule,
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
		app.get(AdminUserCreateRateLimiterService).clear();
		await prisma.auditEvent.deleteMany();
		await prisma.adminUser.deleteMany({ where: { username: { not: 'admin' } } });
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-ADM-USR-RL-INT-01: third create within window → 429', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'one', password: 'OnePass1234567' })
			.expect(201);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'two', password: 'TwoPass1234567' })
			.expect(201);
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'three', password: 'ThreePass123456' })
			.expect(429);
	});

	it('API-ADM-USR-RL-INT-02: rate limit writes admin_user_create_rate_limited audit row', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		for (let index = 0; index < 2; index += 1) {
			await agent
				.post(ADMIN_USERS_API_PATH)
				.set(csrfHeader(csrf))
				.send({ username: `u${index}`, password: `Pass${index}1234567` })
				.expect(201);
		}
		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'blocked', password: 'BlockedPass123' })
			.expect(429);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const row = await prisma.auditEvent.findFirst({
			where: { event: 'admin_user_create_rate_limited' },
		});
		expect(row).not.toBeNull();
	});
});

describe('admin-users integration production password policy (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'ProductionAdmin1';

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

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-adm-usr-prod-${randomUUID()}.db`);
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
							NODE_ENV: 'production',
						}),
					],
				}),
				PrismaModule,
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
		patchSessionCookiesForHttp(app);

		prisma = app.get(PrismaService);
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
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

	it('API-ADM-USR-12: POST weak password in production NODE_ENV → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'weakuser', password: 'short' })
			.expect(400);

		expect(response.body.message).toContain('production strength');
	});

	it('API-ADM-USR-13: POST changeme password in production NODE_ENV → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(ADMIN_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ username: 'bootstrap', password: 'changeme' })
			.expect(400);
	});

	it('API-ADM-USR-31: PATCH weak password in production NODE_ENV → 400', async () => {
		const helper = await createTestAdminUserWithPassword(prisma, 'helper', 'HelperPass123456');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.patch(`${ADMIN_USERS_API_PATH}/${helper.id}`)
			.set(csrfHeader(csrf))
			.send({ password: 'short' })
			.expect(400);
	});
});
