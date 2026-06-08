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
import { ADMIN_CSRF_HEADER_NAME, ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminModule } from '@api/admin/admin.module';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { AdminSessionService } from '@api/admin-auth/services/admin-session.service';
import { IdentityModule } from '@api/identity/identity.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestUser,
	createTestApiConnection,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(60_000);

function adminSessionCookieLine(headers: Record<string, string | string[] | undefined>): string {
	const setCookie = headers['set-cookie'];
	const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
	return cookies.find((value) => value.includes(ADMIN_SESSION_COOKIE_NAME)) ?? '';
}

async function waitForLatestAuditEvent(prisma: PrismaService, event: string, after: Date) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const row = await prisma.auditEvent.findFirst({
			where: { event, createdAt: { gte: after } },
			orderBy: { createdAt: 'desc' },
		});
		if (row) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return null;
}

describe('admin-auth integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-auth-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);

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
							DATABASE_URL: databaseUrl,
							SESSION_SECRET: 'test-session-secret-min-16',
							ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				PrismaModule,
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
		app.get(LoginProtectionService).clear();
		await prisma.user.deleteMany();
		await prisma.apiConnection.deleteMany();
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

	it('API-AUTH-INT-01: login → GET /api/admin/auth/me → 200', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const me = await agent.get('/api/admin/auth/me').expect(200);
		expect(me.body.admin.username).toBe('admin');
	});

	it('API-AUTH-INT-02: Login → GET /api/admin → 200 with counts', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const admin = await agent.get('/api/admin').expect(200);
		expect(admin.body.counts).toBeDefined();
		expect(admin.body.metadataUrl).toContain('/saml/metadata');
		expect(admin.body.apiConnectionsRoute).toContain('api-connections');
	});

	it('API-AUTH-INT-03: No login → GET /api/admin → 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
	});

	it('API-AUTH-INT-04: Login → logout → GET /api/admin → 401', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		await agent
			.post('/api/admin/auth/logout')
			.set(ADMIN_CSRF_HEADER_NAME, login.body.csrfToken)
			.expect(200);
		await agent.get('/api/admin').expect(401);
	});

	it('API-AUTH-INT-05: Admin username matches synced User — admin login uses AdminUser only', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestUser(prisma, connection.id, { username: 'admin' });

		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		expect(login.body.admin.username).toBe('admin');
	});

	it('API-AUTH-INT-06: Cookie has HttpOnly flag', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const setCookie = response.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		expect(cookies.some((value) => value.includes(`${ADMIN_SESSION_COOKIE_NAME}=`))).toBe(true);
		expect(cookies.some((value) => value.toLowerCase().includes('httponly'))).toBe(true);
	});

	it('API-AUTH-INT-07: Login → delete admin → GET /me → 401', async () => {
		const temp = await createTestAdminUserWithPassword(prisma, 'temp-admin', 'temp-pass-12345');
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'temp-admin', password: 'temp-pass-12345' })
			.expect(200);

		await prisma.adminUser.delete({ where: { id: temp.id } });
		await agent.get('/api/admin/auth/me').expect(401);
	});

	it('API-AUTH-INT-08: 401 responses match ApiErrorResponseDto shape', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
		expect(response.body).toMatchObject({
			statusCode: 401,
			message: 'Unauthorized',
		});
	});

	it('API-AUTH-INT-09: wrong password → 401 Invalid credentials', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong-password' })
			.expect(401);
		expect(response.body.message).toBe('Invalid credentials');
	});

	it('API-AUTH-INT-10: unknown username → 401 same message as wrong password', async () => {
		const wrongPass = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong-password' })
			.expect(401);
		const unknownUser = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'nobody-here', password: 'any-password' })
			.expect(401);
		expect(wrongPass.body.message).toBe(unknownUser.body.message);
	});

	it('API-AUTH-INT-11: empty body → 400 validation error', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({})
			.expect(400);
	});

	it('API-AUTH-INT-12: extra fields → 400 forbidNonWhitelisted', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, evil: true })
			.expect(400);
	});

	it('API-AUTH-INT-13: missing password → 400', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin' })
			.expect(400);
	});

	it('API-AUTH-INT-14: GET /me without cookie → 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin/auth/me')
			.expect(401);
	});

	it('API-AUTH-INT-15: login response never includes passwordHash', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		expect(response.body.ok).toBe(true);
		expect(response.body.admin).toEqual({ id: expect.any(String), username: 'admin' });
		expect(response.body.admin).not.toHaveProperty('passwordHash');
	});

	it('API-AUTH-INT-16: logout without prior login still returns ok', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/logout')
			.expect(200);
		expect(response.body).toEqual({ ok: true });
	});

	it('API-AUTH-INT-17: cookie includes SameSite=Lax and Path=/', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const setCookie = response.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const sessionCookie = cookies.find((value) => value.includes(ADMIN_SESSION_COOKIE_NAME));
		expect(sessionCookie?.toLowerCase()).toContain('samesite=lax');
		expect(sessionCookie).toContain('Path=/');
	});

	it('API-AUTH-INT-18: tampered session cookie → 401 on /me', async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const setCookie = loginRes.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const sessionLine = cookies.find((value) => value.includes(ADMIN_SESSION_COOKIE_NAME));
		const match = sessionLine?.match(new RegExp(`${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`));
		expect(match).toBeDefined();

		await request(app.getHttpServer() as App)
			.get('/api/admin/auth/me')
			.set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${match![1]}tampered`)
			.expect(401);
	});

	it('API-AUTH-INT-19: 429 after the per-username throttle is exceeded (admin)', async () => {
		// Admin login is now throttled per-username (default max 5) as well as per-IP (Prompt 35).
		for (let i = 0; i < 5; i += 1) {
			await request(app.getHttpServer() as App)
				.post('/api/admin/auth/login')
				.send({ username: 'admin', password: 'wrong' })
				.expect(401);
		}
		const blocked = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong' })
			.expect(429);
		expect(blocked.body.message).toBe('Too many login attempts');
	});

	it('API-AUTH-INT-20: successful login resets rate limit counter', async () => {
		for (let i = 0; i < 4; i += 1) {
			await request(app.getHttpServer() as App)
				.post('/api/admin/auth/login')
				.send({ username: 'admin', password: 'wrong' })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		for (let i = 0; i < 5; i += 1) {
			await request(app.getHttpServer() as App)
				.post('/api/admin/auth/login')
				.send({ username: 'admin', password: 'wrong' })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong' })
			.expect(429);
	});

	it('API-AUTH-INT-21: login response matches AdminLoginResponseDto shape', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		expect(response.body).toMatchObject({
			ok: true,
			admin: { id: expect.any(String), username: 'admin' },
			csrfToken: expect.any(String),
		});
	});

	it('API-AUTH-INT-22: invalid credentials returns 401 not 500', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'bad' })
			.expect(401);
	});

	it('API-AUTH-INT-23: createTestAdminUserWithPassword allows login with known password', async () => {
		await createTestAdminUserWithPassword(prisma, 'fixture-user', 'fixture-known-pass');
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'fixture-user', password: 'fixture-known-pass' })
			.expect(200);
	});

	it('API-ADM-AUTH-24: rememberMe true sets long Max-Age on session cookie', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: true })
			.expect(200);
		const line = adminSessionCookieLine(response.headers);
		const match = line.match(/Max-Age=(\d+)/i);
		expect(match).not.toBeNull();
		expect(Number.parseInt(match![1], 10)).toBeGreaterThanOrEqual(2_500_000);
	});

	it('API-ADM-AUTH-25: login without rememberMe omits Max-Age (session cookie)', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const line = adminSessionCookieLine(response.headers);
		expect(line.toLowerCase()).not.toContain('max-age=');
	});

	it('API-ADM-AUTH-26: rememberMe true with wrong password returns 401 without cookie', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong', rememberMe: true })
			.expect(401);
		expect(adminSessionCookieLine(response.headers)).toBe('');
	});

	it('API-ADM-AUTH-27: invalid rememberMe type returns 400', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: 'yes' })
			.expect(400);
	});

	it('API-ADM-AUTH-28: persistent session works on GET /me until tampered', async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: true })
			.expect(200);
		const line = adminSessionCookieLine(loginRes.headers);
		const match = line.match(new RegExp(`${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`));
		expect(match).toBeDefined();
		await request(app.getHttpServer() as App)
			.get('/api/admin/auth/me')
			.set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${match![1]}`)
			.expect(200);
		await request(app.getHttpServer() as App)
			.get('/api/admin/auth/me')
			.set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${match![1]}tampered`)
			.expect(401);
	});

	it('API-ADM-AUTH-29: change-password keeps session valid', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: true })
			.expect(200);
		await agent
			.post('/api/admin/auth/change-password')
			.set(ADMIN_CSRF_HEADER_NAME, login.body.csrfToken as string)
			.send({ currentPassword: adminPassword, newPassword: adminPassword })
			.expect(400);
		await agent.get('/api/admin/auth/me').expect(200);
	});

	it('API-ADM-AUTH-30: logout clears cookie then login works again', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		await agent
			.post('/api/admin/auth/logout')
			.set(ADMIN_CSRF_HEADER_NAME, login.body.csrfToken as string)
			.expect(200);
		await agent.get('/api/admin/auth/me').expect(401);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
	});

	it('API-AUD-ADM-RM-01: rememberMe true records audit metadata', async () => {
		const after = new Date();
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: true })
			.expect(200);
		const row = await waitForLatestAuditEvent(prisma, 'admin_login_success', after);
		expect(row?.metadata).toEqual({ rememberMe: true });
	});

	it('API-AUD-ADM-RM-02: login without rememberMe omits rememberMe metadata', async () => {
		const after = new Date();
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const row = await waitForLatestAuditEvent(prisma, 'admin_login_success', after);
		const metadata = row?.metadata as Record<string, unknown> | null;
		expect(metadata?.rememberMe).toBeUndefined();
	});

	it('API-ADM-AUTH-31: rememberMe false explicit still omits Max-Age', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: false })
			.expect(200);
		expect(adminSessionCookieLine(response.headers).toLowerCase()).not.toContain('max-age=');
	});

	it('API-ADM-AUTH-32: rememberMe string true coerces to persistent cookie', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: 'true' })
			.expect(200);
		expect(adminSessionCookieLine(response.headers).toLowerCase()).toContain('max-age=');
	});

	it('API-ADM-AUTH-33: persistent session payload exp reflects long TTL', async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword, rememberMe: true })
			.expect(200);
		const line = adminSessionCookieLine(loginRes.headers);
		const match = line.match(new RegExp(`${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`));
		expect(match).toBeDefined();
		const sessionService = app.get(AdminSessionService);
		const payload = sessionService.verify(match![1]);
		expect(payload).not.toBeNull();
		const ttl = payload!.exp - payload!.iat;
		expect(ttl).toBeGreaterThanOrEqual(2_500_000);
		expect(ttl).toBeLessThanOrEqual(7_776_000);
	});

	it('API-ADM-AUTH-34: wrong password with rememberMe true returns 401 without cookie', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong-pass', rememberMe: true })
			.expect(401);
		expect(adminSessionCookieLine(response.headers)).toBe('');
	});

	it('API-AUD-ADM-RM-03: failed login with rememberMe records failure not success metadata', async () => {
		const after = new Date();
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong-pass', rememberMe: true })
			.expect(401);
		const failure = await waitForLatestAuditEvent(prisma, 'admin_login_failure', after);
		expect(failure?.actorLabel).toBe('admin');
		const success = await prisma.auditEvent.findFirst({
			where: { event: 'admin_login_success', createdAt: { gte: after } },
		});
		expect(success).toBeNull();
	});

	it('API-CSRF-03: GET list connections without CSRF → 200 when authenticated', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		await agent.get('/api/admin/api-connections').expect(200);
	});

	it('API-CSRF-04: Login response includes csrfToken; cookie payload contains same value', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		expect(response.body.csrfToken).toEqual(expect.any(String));
		expect(response.body.csrfToken.length).toBeGreaterThan(0);

		const setCookie = response.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const sessionLine = cookies.find((value) => value.includes(ADMIN_SESSION_COOKIE_NAME));
		const match = sessionLine?.match(new RegExp(`${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`));
		expect(match).toBeDefined();

		const { AdminSessionService } = await import('@api/admin-auth/services/admin-session.service');
		const sessionService = app.get(AdminSessionService);
		const payload = sessionService.verify(match![1]);
		expect(payload?.csrfToken).toBe(response.body.csrfToken);
	});

	it('API-CSRF-05: Logout requires valid CSRF when session present', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		await agent.post('/api/admin/auth/logout').expect(403);
	});

	it('API-CSRF-07: GET /me returns same csrfToken as login (no rotation)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const me = await agent.get('/api/admin/auth/me').expect(200);
		expect(me.body.csrfToken).toBe(login.body.csrfToken);
	});

	it('API-CSRF-08: Login → logout → login → old CSRF header on PATCH → 403; new CSRF succeeds', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const firstLogin = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const staleCsrf = firstLogin.body.csrfToken as string;

		await agent.post('/api/admin/auth/logout').set(ADMIN_CSRF_HEADER_NAME, staleCsrf).expect(200);

		const secondLogin = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const freshCsrf = secondLogin.body.csrfToken as string;

		await agent
			.post('/api/admin/api-connections')
			.set(ADMIN_CSRF_HEADER_NAME, staleCsrf)
			.send({
				name: 'Should fail',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(403);

		await agent
			.post('/api/admin/api-connections')
			.set(ADMIN_CSRF_HEADER_NAME, freshCsrf)
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);
	});

	it('API-CSRF-06: legacy session without csrfToken → GET /me ok, mutating POST 403', async () => {
		const sessionService = app.get(AdminSessionService);
		const admin = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
		expect(admin).not.toBeNull();

		const now = Math.floor(Date.now() / 1000);
		const legacyToken = sessionService.sign({
			adminUserId: admin!.id,
			username: admin!.username,
			iat: now,
			exp: now + 3600,
		} as Parameters<AdminSessionService['sign']>[0]);

		const agent = request.agent(app.getHttpServer() as App);
		const me = await agent
			.get('/api/admin/auth/me')
			.set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${legacyToken}`)
			.expect(200);

		expect(me.body.admin.username).toBe('admin');
		expect(me.body.csrfToken).toBe('');

		await agent
			.post('/api/admin/api-connections')
			.set('Cookie', `${ADMIN_SESSION_COOKIE_NAME}=${legacyToken}`)
			.send({
				name: 'Legacy CSRF test',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(403);
	});

	it('API-CSRF-02: wrong CSRF header on POST create → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		await agent
			.post('/api/admin/api-connections')
			.set(ADMIN_CSRF_HEADER_NAME, 'definitely-wrong-csrf')
			.send({
				name: 'Corp',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(403);
	});
});
