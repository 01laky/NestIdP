import { randomUUID } from 'node:crypto';
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
import { AdminUsersModule } from '@api/admin-users/admin-users.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { IdentityModule } from '@api/identity/identity.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { createTestAdminUserWithPassword } from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(60_000);

function cookieLine(headers: Record<string, string | string[] | undefined>): string {
	const setCookie = headers['set-cookie'];
	const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
	return cookies.find((value) => value.includes(ADMIN_SESSION_COOKIE_NAME)) ?? '';
}

async function waitForAudit(prisma: PrismaService, event: string, after: Date) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
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

/**
 * End-to-end brute-force protection (Prompt 35) driven through the real admin login + unlock endpoints,
 * with lockout ENABLED (threshold 3) and throttle/ban set high so the account-lockout layer is what trips.
 */
describe('auth-protection integration (SQLite, lockout enabled)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	const password = 'integration-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-bf-${randomUUID()}.db`);
		const databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		const prismaService = new PrismaService({ datasources: { db: { url: databaseUrl } } });

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
							// Lockout ON; throttle/ban high so the lockout layer is the one that trips.
							LOGIN_LOCKOUT_THRESHOLD: 3,
							LOGIN_LOCKOUT_BASE_MS: 60_000,
							LOGIN_LOCKOUT_PRUNE_INTERVAL_MS: 0,
							ADMIN_LOGIN_RATE_LIMIT_MAX: 1000,
							ADMIN_LOGIN_RATE_LIMIT_USERNAME_MAX: 1000,
							LOGIN_IP_BAN_THRESHOLD: 0,
						}),
					],
				}),
				PrismaModule,
				IdentityModule,
				AdminAuthModule,
				AdminUsersModule,
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
		await createTestAdminUserWithPassword(prisma, 'victim', password);
		await createTestAdminUserWithPassword(prisma, 'operator', password);
	});

	beforeEach(async () => {
		app.get(LoginProtectionService).clear();
		await prisma.loginLockout.deleteMany();
	});

	afterAll(async () => {
		await app.close();
	});

	async function login(username: string): Promise<{ cookie: string; csrf: string }> {
		const res = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username, password })
			.expect(200);
		return { cookie: cookieLine(res.headers), csrf: res.body.csrfToken as string };
	}

	async function failLogin(username: string): Promise<number> {
		const res = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username, password: 'wrong-password' });
		return res.status;
	}

	it('LOCK-HTTP-01: account locks after the threshold and rejects even a correct password', async () => {
		const since = new Date();
		expect(await failLogin('victim')).toBe(401);
		expect(await failLogin('victim')).toBe(401);
		expect(await failLogin('victim')).toBe(401); // 3rd failure locks the account
		// further attempts are rejected up-front with 429 — even the CORRECT password
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'victim', password })
			.expect(429);
		const locked = await waitForAudit(prisma, 'admin_login_locked', since);
		expect(locked).not.toBeNull();
		const row = await prisma.loginLockout.findUnique({
			where: { scope_usernameKey: { scope: 'admin', usernameKey: 'victim' } },
		});
		expect(row?.lockedUntil).not.toBeNull();
	});

	it('UNLOCK-API-01: operator unlock clears the lockout, is audited, and login works again', async () => {
		await failLogin('victim');
		await failLogin('victim');
		await failLogin('victim');
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'victim', password })
			.expect(429);

		const op = await login('operator');
		const victimRow = await prisma.adminUser.findUnique({ where: { username: 'victim' } });
		const since = new Date();
		await request(app.getHttpServer() as App)
			.post(`/api/admin/admin-users/${victimRow!.id}/unlock`)
			.set('Cookie', op.cookie)
			.set(ADMIN_CSRF_HEADER_NAME, op.csrf)
			.expect(200);
		expect(await waitForAudit(prisma, 'admin_account_unlocked', since)).not.toBeNull();

		// victim can log in again immediately
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'victim', password })
			.expect(200);
	});

	it('UNLOCK-API-02: unlock requires admin auth + CSRF (401/403)', async () => {
		const victimRow = await prisma.adminUser.findUnique({ where: { username: 'victim' } });
		// no session cookie → 401
		await request(app.getHttpServer() as App)
			.post(`/api/admin/admin-users/${victimRow!.id}/unlock`)
			.expect(401);
		// session cookie but missing CSRF header → 403
		const op = await login('operator');
		await request(app.getHttpServer() as App)
			.post(`/api/admin/admin-users/${victimRow!.id}/unlock`)
			.set('Cookie', op.cookie)
			.expect(403);
	});

	it('DTO-01: the admin-users list surfaces the lockout block (locked flag)', async () => {
		await failLogin('victim');
		await failLogin('victim');
		await failLogin('victim');

		const op = await login('operator');
		const res = await request(app.getHttpServer() as App)
			.get('/api/admin/admin-users')
			.set('Cookie', op.cookie)
			.expect(200);
		const victim = (res.body as Array<{ username: string; lockout?: { locked: boolean } }>).find(
			(u) => u.username === 'victim',
		);
		expect(victim?.lockout?.locked).toBe(true);
		const operator = (res.body as Array<{ username: string; lockout?: { locked: boolean } }>).find(
			(u) => u.username === 'operator',
		);
		expect(operator?.lockout?.locked).toBe(false);
	});

	it('RESET-HTTP-01: a successful login clears the failure counter before lockout', async () => {
		await failLogin('victim'); // count 1
		await failLogin('victim'); // count 2
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'victim', password })
			.expect(200); // success resets
		// counter reset → two more failures do NOT lock (would need 3 from zero)
		expect(await failLogin('victim')).toBe(401);
		expect(await failLogin('victim')).toBe(401);
		const row = await prisma.loginLockout.findUnique({
			where: { scope_usernameKey: { scope: 'admin', usernameKey: 'victim' } },
		});
		expect(row?.lockedUntil ?? null).toBeNull();
	});
});
