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
import { AdminModule } from '../admin/admin.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { LoginRateLimiterService } from '../admin-auth/login-rate-limiter.service';
import { PasswordService } from '../admin-auth/password.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { createTestAdminUserWithPassword } from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { AdminSessionService } from './admin-session.service';

jest.setTimeout(60_000);

function patchSessionCookiesForHttp(app: INestApplication): void {
	const sessionService = app.get(AdminSessionService);
	const sign = (
		sessionService as unknown as {
			sign: (payload: import('./admin-session.service').AdminSessionPayload) => string;
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

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

async function waitForAuditEvent(prisma: PrismaService, event: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const row = await prisma.auditEvent.findFirst({
			where: { event },
		});
		if (row) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return null;
}

describe('admin change-password integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';
	const newPassword = 'NewSecurePass1234';

	async function loginAgent(agent: ReturnType<typeof request.agent>, password = adminPassword) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password })
			.expect(200);
		return login.body.csrfToken as string;
	}

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-adm-pwd-${randomUUID()}.db`);
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
		await prisma.auditEvent.deleteMany();
		const admin = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
		const passwordHash = await app.get(PasswordService).hash(adminPassword);
		await prisma.adminUser.update({
			where: { id: admin!.id },
			data: { passwordHash },
		});
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

	it('API-ADM-PWD-01: unauthenticated POST change-password → 401', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/change-password')
			.send({ currentPassword: adminPassword, newPassword })
			.expect(401);
	});

	it('API-ADM-PWD-02: change password without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent
			.post('/api/admin/auth/change-password')
			.send({ currentPassword: adminPassword, newPassword })
			.expect(403);
	});

	it('API-ADM-PWD-03: change password with wrong current password → 401', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: 'wrong-current-password', newPassword })
			.expect(401);
	});

	it('API-ADM-PWD-04: change password same as current → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: adminPassword, newPassword: adminPassword })
			.expect(400);
	});

	it('API-ADM-PWD-05: successful change password → 200 ok true', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: adminPassword, newPassword })
			.expect(200);

		expect(response.body).toEqual({ ok: true });
	});

	it('API-ADM-PWD-06: can login with new password after change', async () => {
		const changeAgent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(changeAgent);

		await changeAgent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: adminPassword, newPassword })
			.expect(200);

		const loginAgentFresh = request.agent(app.getHttpServer() as App);
		await loginAgentFresh
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: newPassword })
			.expect(200);

		await loginAgentFresh
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(401);
	});

	it('API-ADM-PWD-07: change password persists admin_password_changed audit event', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: adminPassword, newPassword: 'AnotherNewPass99' })
			.expect(200);

		const row = await waitForAuditEvent(prisma, 'admin_password_changed');
		expect(row).not.toBeNull();
		expect(row!.category).toBe('admin_auth');
	});
});

describe('admin change-password production policy (SQLite)', () => {
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
		const tmpDb = join(tmpdir(), `nestidp-adm-pwd-prod-${randomUUID()}.db`);
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

	it('API-ADM-PWD-08: weak new password in production NODE_ENV → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const response = await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({ currentPassword: adminPassword, newPassword: 'weak' })
			.expect(400);

		expect(response.body.message).toContain('production strength');
	});
});

describe('admin change-password validation edge cases (SQLite)', () => {
	let app: INestApplication;
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
		const tmpDb = join(tmpdir(), `nestidp-adm-pwd-val-${randomUUID()}.db`);
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
		await createTestAdminUserWithPassword(app.get(PrismaService), 'admin', adminPassword);
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-ADM-PWD-09: empty body → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent.post('/api/admin/auth/change-password').set(csrfHeader(csrf)).send({}).expect(400);
	});

	it('API-ADM-PWD-10: extra fields → 400 forbidNonWhitelisted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post('/api/admin/auth/change-password')
			.set(csrfHeader(csrf))
			.send({
				currentPassword: adminPassword,
				newPassword: 'BrandNewPass123',
				confirmPassword: 'ignored',
			})
			.expect(400);
	});
});
