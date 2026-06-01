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
import { ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminModule } from '../admin/admin.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { LoginRateLimiterService } from '../admin-auth/login-rate-limiter.service';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestUser,
	createTestApiConnection,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';

jest.setTimeout(60_000);

describe('admin-auth integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-auth-${randomUUID()}.db`);
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

	beforeEach(() => {
		app.get(LoginRateLimiterService).clear();
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
		expect(admin.body.module).toBe('admin');
		expect(admin.body.counts).toBeDefined();
	});

	it('API-AUTH-INT-03: No login → GET /api/admin → 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
	});

	it('API-AUTH-INT-04: Login → logout → GET /api/admin → 401', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		await agent.post('/api/admin/auth/logout').expect(200);
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

	it('API-AUTH-INT-19: 429 after 11 failed login attempts from same IP', async () => {
		for (let i = 0; i < 10; i += 1) {
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
		for (let i = 0; i < 9; i += 1) {
			await request(app.getHttpServer() as App)
				.post('/api/admin/auth/login')
				.send({ username: 'admin', password: 'wrong' })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		for (let i = 0; i < 10; i += 1) {
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
});
