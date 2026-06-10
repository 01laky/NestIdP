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
	ADMIN_SESSION_COOKIE_NAME,
	AUTH_API_PATH,
	END_USER_SESSION_COOKIE_NAME,
} from '@nestidp/shared';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { AuthModule } from '@api/auth/auth.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestIdpSettingsWithSigningKey,
	createTestSamlSession,
	createTestSpConnection,
	createTestUserWithPassword,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { INVALID_CREDENTIALS_MESSAGE } from '@api/auth/services/end-user-auth.service';

jest.setTimeout(60_000);

describe('end-user auth integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const endUserPassword = 'integration-end-user-pass';
	const adminPassword = 'integration-admin-pass';
	let connectionId: string;
	let spConnectionId: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-end-user-auth-${randomUUID()}.db`);
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
				EncryptionModule,
				AuthModule,
				AdminAuthModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();

		prisma = app.get(PrismaService);
		const connection = await createTestApiConnection(prisma);
		connectionId = connection.id;
		const sp = await createTestSpConnection(prisma);
		spConnectionId = sp.id;
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		await createTestUserWithPassword(prisma, connectionId, 'alice', endUserPassword);
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
	});

	beforeEach(async () => {
		app.get(LoginProtectionService).clear();
		await prisma.samlSession.deleteMany();
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

	it('API-AUTH-INT-01: login → GET /api/auth/me → 200', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		const me = await agent.get(`${AUTH_API_PATH}/me`).expect(200);
		expect(me.body.user.username).toBe('alice');
	});

	it('LOGIN-NOSESSION-01: login → GET /api/auth/session WITHOUT a samlSessionId leaks no identity', async () => {
		// Strict SP-only IdP (Prompt 36, Deliverable 10): a standing cookie must NOT advertise a session.
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		const session = await agent.get(`${AUTH_API_PATH}/session`).expect(200);
		expect(session.body.authenticated).toBe(false);
		expect(session.body.user).toBeNull();
	});

	it('API-AUTH-INT-03: no login → GET /api/auth/me → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/me`)
			.expect(401);
	});

	it('API-AUTH-INT-04: login → logout → GET /api/auth/me → 401', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		await agent.post(`${AUTH_API_PATH}/logout`).expect(200);
		await agent.get(`${AUTH_API_PATH}/me`).expect(401);
	});

	it('API-AUTH-INT-05: synced username matches admin — end-user login uses User only', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'admin', 'not-admin-pass');
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'admin', password: 'not-admin-pass' })
			.expect(200);
		expect(login.body.user.username).toBe('admin');
	});

	it('API-AUTH-INT-06: cookie has HttpOnly flag', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		const setCookie = response.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		expect(cookies.some((value) => value.includes(`${END_USER_SESSION_COOKIE_NAME}=`))).toBe(true);
		expect(cookies.some((value) => value.toLowerCase().includes('httponly'))).toBe(true);
	});

	it('API-AUTH-INT-07: login → delete user → GET /me → 401', async () => {
		const temp = await createTestUserWithPassword(
			prisma,
			connectionId,
			'temp-user',
			'temp-pass-12345',
		);
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'temp-user', password: 'temp-pass-12345' })
			.expect(200);

		await prisma.user.delete({ where: { id: temp.id } });
		await agent.get(`${AUTH_API_PATH}/me`).expect(401);
	});

	it('API-AUTH-INT-08: 401 responses match ApiErrorResponseDto shape', async () => {
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/me`)
			.expect(401);
		expect(response.body).toMatchObject({
			statusCode: 401,
			message: 'Unauthorized',
		});
	});

	it('API-AUTH-INT-09: wrong password → 401 Invalid username or password', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'wrong-password' })
			.expect(401);
		expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
	});

	it('API-AUTH-INT-10: unknown username → 401 same message as wrong password', async () => {
		const wrongPass = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'wrong-password' })
			.expect(401);
		const unknownUser = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'nobody-here', password: 'any-password' })
			.expect(401);
		expect(wrongPass.body.message).toBe(unknownUser.body.message);
		expect(wrongPass.body.message).toBe('Invalid username or password');
	});

	it('API-AUTH-INT-11: empty body → 400 validation error', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({})
			.expect(400);
	});

	it('API-AUTH-INT-12: extra fields → 400 forbidNonWhitelisted', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, evil: true })
			.expect(400);
	});

	it('API-AUTH-INT-13: missing password → 400', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice' })
			.expect(400);
	});

	it('API-AUTH-INT-14: GET /me without cookie → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/me`)
			.expect(401);
	});

	it('API-AUTH-INT-15: login response never includes passwordHash', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		expect(response.body.ok).toBe(true);
		expect(response.body.user).toMatchObject({
			id: expect.any(String),
			username: 'alice',
			groups: expect.any(Array),
			roles: expect.any(Array),
		});
		expect(response.body.user).not.toHaveProperty('passwordHash');
		expect(response.body.user).not.toHaveProperty('apiConnectionId');
	});

	it('API-AUTH-INT-16: logout without prior login still returns ok', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/logout`)
			.expect(200);
		expect(response.body).toEqual({ ok: true });
	});

	it('API-AUTH-INT-17: cookie includes SameSite=Lax and Path=/', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		const setCookie = response.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const sessionCookie = cookies.find((value) => value.includes(END_USER_SESSION_COOKIE_NAME));
		expect(sessionCookie?.toLowerCase()).toContain('samesite=lax');
		expect(sessionCookie).toContain('Path=/');
	});

	it('API-AUTH-INT-18: tampered session cookie → 401 on /me', async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		const setCookie = loginRes.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const sessionLine = cookies.find((value) => value.includes(END_USER_SESSION_COOKIE_NAME));
		const match = sessionLine?.match(new RegExp(`${END_USER_SESSION_COOKIE_NAME}=([^;]+)`));
		expect(match).toBeDefined();

		await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/me`)
			.set('Cookie', `${END_USER_SESSION_COOKIE_NAME}=${match![1]}tampered`)
			.expect(401);
	});

	it('API-AUTH-INT-19: 429 after 11 failed login attempts from same IP', async () => {
		for (let i = 0; i < 10; i += 1) {
			await request(app.getHttpServer() as App)
				.post(`${AUTH_API_PATH}/login`)
				.send({ username: `rate-ip-${i}`, password: 'wrong' })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'rate-ip-10', password: 'wrong' })
			.expect(429);
	});

	it('API-AUTH-INT-20: successful login resets rate limit counter', async () => {
		for (let i = 0; i < 9; i += 1) {
			await request(app.getHttpServer() as App)
				.post(`${AUTH_API_PATH}/login`)
				.send({ username: `rate-reset-${i}`, password: 'wrong' })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'wrong' })
			.expect(401);
	});

	it('API-AUTH-INT-21: login response matches EndUserLoginResponseDto shape', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		expect(response.body).toMatchObject({
			ok: true,
			user: { id: expect.any(String), username: 'alice' },
			samlSessionBound: false,
		});
	});

	it('API-AUTH-INT-22: invalid credentials returns 401 not 500', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'bad' })
			.expect(401);
	});

	it('API-AUTH-INT-23: createTestUserWithPassword allows login with known password', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'fixture-user', 'fixture-known-pass');
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'fixture-user', password: 'fixture-known-pass' })
			.expect(200);
	});

	it('API-AUTH-INT-24: admin session cookie does not authorize /api/auth/me', async () => {
		const adminAgent = request.agent(app.getHttpServer() as App);
		await adminAgent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		await adminAgent.get(`${AUTH_API_PATH}/me`).expect(401);
	});

	it('API-AUTH-INT-25: end-user session cookie does not authorize /api/admin', async () => {
		const userAgent = request.agent(app.getHttpServer() as App);
		await userAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		await userAgent.get('/api/admin/auth/me').expect(401);
	});

	it('API-AUTH-INT-26: login with samlSessionId binds session', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: session.id,
			})
			.expect(200);

		expect(login.body.samlSessionBound).toBe(true);
		const row = await prisma.samlSession.findUnique({ where: { id: session.id } });
		expect(row?.userId).not.toBeNull();

		const status = await agent
			.get(`${AUTH_API_PATH}/session?samlSessionId=${session.id}`)
			.expect(200);
		expect(status.body.samlSession?.bound).toBe(true);
		expect(status.body.samlSession?.readyToComplete).toBe(true);
	});

	it('API-AUTH-INT-28: username lookup is case-sensitive', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'CaseSensitive', 'case-pass-12345');
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'casesensitive', password: 'case-pass-12345' })
			.expect(401);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'CaseSensitive', password: 'case-pass-12345' })
			.expect(200);
	});

	it('API-AUTH-INT-29: login trims username whitespace', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: '  alice  ', password: endUserPassword })
			.expect(200);
		const me = await agent.get(`${AUTH_API_PATH}/me`).expect(200);
		expect(me.body.user.username).toBe('alice');
	});

	it('API-AUTH-INT-30: inactive synced user cannot login', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'inactive-user', 'inactive-pass-1', {
			active: false,
		});
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'inactive-user', password: 'inactive-pass-1' })
			.expect(401);
		expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
	});

	it('API-AUTH-INT-31: GET /session without cookie returns unauthenticated', async () => {
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session`)
			.expect(200);
		expect(response.body).toEqual({
			authenticated: false,
			user: null,
			samlSession: null,
		});
	});

	it('API-AUTH-INT-32: GET /session rejects invalid samlSessionId query', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session?samlSessionId=not-valid`)
			.expect(400);
	});

	it('API-AUTH-INT-33: GET /session with unknown samlSessionId omits samlSession', async () => {
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session?samlSessionId=clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.expect(200);
		expect(response.body.samlSession).toBeNull();
	});

	it('API-AUTH-INT-34: GET /session reports expired SAML session', async () => {
		const expired = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session?samlSessionId=${expired.id}`)
			.expect(200);
		expect(response.body.samlSession).toMatchObject({
			id: expired.id,
			bound: false,
			expired: true,
			spActive: true,
		});
	});

	it('API-AUTH-INT-35: login with invalid samlSessionId format → 400', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: 'bad-id',
			})
			.expect(400);
	});

	it('API-AUTH-INT-36: login with unknown samlSessionId → 400', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
			})
			.expect(400);
	});

	it('API-AUTH-INT-37: login with expired samlSessionId → 400', async () => {
		const expired = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: expired.id,
			})
			.expect(400);
	});

	it('API-AUTH-INT-38: login with already-bound SAML session → 409', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId, {
			userId: (await prisma.user.findFirst({ where: { username: 'alice' } }))!.id,
		});
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: session.id,
			})
			.expect(409);
	});

	it('API-AUTH-INT-39: 429 after repeated failures for same username', async () => {
		for (let i = 0; i < 5; i += 1) {
			await request(app.getHttpServer() as App)
				.post(`${AUTH_API_PATH}/login`)
				.send({ username: 'alice', password: `wrong-username-rate-${i}` })
				.expect(401);
		}
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'wrong-username-rate-final' })
			.expect(429);
	});

	it('API-AUTH-INT-40: POST /login/complete-sso without session returns 401', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(401);
	});

	it('API-AUTH-INT-41: complete-sso without session rejects unauthorized', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: 'nope' })
			.expect(401);
	});

	it('API-AUTH-INT-42: logout clears session cookie', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		const logoutRes = await agent.post(`${AUTH_API_PATH}/logout`).expect(200);
		expect(logoutRes.body).toEqual({ ok: true });

		const setCookie = logoutRes.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		const cleared = cookies.find((value) => value.includes(END_USER_SESSION_COOKIE_NAME));
		expect(cleared).toBeDefined();
		expect(
			cleared?.toLowerCase().includes('max-age=0') || cleared?.toLowerCase().includes('expires='),
		).toBe(true);
	});

	it('API-AUTH-INT-43: deactivated user after login → /me 401 and cookie cleared', async () => {
		const temp = await createTestUserWithPassword(
			prisma,
			connectionId,
			'deactivate-me',
			'deactivate-pass-1',
		);
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'deactivate-me', password: 'deactivate-pass-1' })
			.expect(200);

		await prisma.user.update({ where: { id: temp.id }, data: { active: false } });
		const meRes = await agent.get(`${AUTH_API_PATH}/me`).expect(401);
		const setCookie = meRes.headers['set-cookie'];
		const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
		expect(cookies.some((value) => value.includes(END_USER_SESSION_COOKIE_NAME))).toBe(true);
	});

	it('API-AUTH-INT-44: login rejects username longer than 128 characters', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'a'.repeat(129), password: endUserPassword })
			.expect(400);
	});

	it('API-AUTH-INT-45: GET /me returns groups and roles from profile', async () => {
		const user = await createTestUserWithPassword(
			prisma,
			connectionId,
			'groups-user',
			'groups-pass-12345',
		);
		const group = await prisma.group.create({
			data: {
				apiConnectionId: connectionId,
				externalId: 'g-ext-1',
				name: 'Beta',
			},
		});
		const role = await prisma.role.create({
			data: {
				apiConnectionId: connectionId,
				externalId: 'r-ext-1',
				name: 'Viewer',
			},
		});
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
		await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'groups-user', password: 'groups-pass-12345' })
			.expect(200);
		const me = await agent.get(`${AUTH_API_PATH}/me`).expect(200);
		expect(me.body.user.groups).toEqual(['Beta']);
		expect(me.body.user.roles).toEqual(['Viewer']);
	});

	it('API-AUTH-INT-46: SAML bind failure does not set session cookie', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: session.id,
			})
			.expect(400);
		const setCookie = response.headers['set-cookie'];
		expect(setCookie).toBeUndefined();
	});

	it('API-AUTH-INT-50: correct-password bind failure does NOT record a login failure; bad password does (§5.A8)', async () => {
		const lp = app.get(LoginProtectionService);
		const spy = jest.spyOn(lp, 'recordLoginFailure');

		// correct password, but the SAML session is expired → bind fails with 400. The credential was
		// valid, so this must NOT poison the throttle / lockout counters.
		const session = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId: session.id })
			.expect(400);
		expect(spy).not.toHaveBeenCalled();

		// contrast: a genuinely wrong password IS recorded as a login failure
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: 'definitely-wrong-password' })
			.expect(401);
		expect(spy).toHaveBeenCalledWith('end_user', 'alice', expect.any(String));

		spy.mockRestore();
	});

	it('API-AUTH-INT-47: GET /session with inactive SP reports spActive false', async () => {
		const inactiveSp = await createTestSpConnection(prisma, { active: false });
		const session = await createTestSamlSession(prisma, inactiveSp.id);
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session?samlSessionId=${session.id}`)
			.expect(200);
		expect(response.body.samlSession?.spActive).toBe(false);
		expect(response.body.samlSession?.readyToComplete).toBe(false);
	});

	it('API-AUTH-INT-48: unbound SAML session has readyToComplete false', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session?samlSessionId=${session.id}`)
			.expect(200);
		expect(response.body.samlSession?.readyToComplete).toBe(false);
	});

	it('API-AUTH-INT-49: bound session with auth cookie has readyToComplete true', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: session.id,
			})
			.expect(200);
		const status = await agent
			.get(`${AUTH_API_PATH}/session?samlSessionId=${session.id}`)
			.expect(200);
		expect(status.body.samlSession?.readyToComplete).toBe(true);
	});

	it('API-AUTH-INT-50: expired SAML session has readyToComplete false', async () => {
		const expired = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({
				username: 'alice',
				password: endUserPassword,
				samlSessionId: expired.id,
			})
			.expect(400);
		const status = await agent
			.get(`${AUTH_API_PATH}/session?samlSessionId=${expired.id}`)
			.expect(200);
		expect(status.body.samlSession?.readyToComplete).toBe(false);
	});

	it('API-AUTH-INT-52: wrong user cookie yields readyToComplete false', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'bob', 'bob-pass-12345');
		const session = await createTestSamlSession(prisma, spConnectionId);
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'bob', password: 'bob-pass-12345' })
			.expect(200);
		const alice = await prisma.user.findFirst({ where: { username: 'alice' } });
		await prisma.samlSession.update({
			where: { id: session.id },
			data: { userId: alice!.id },
		});
		const status = await agent
			.get(`${AUTH_API_PATH}/session?samlSessionId=${session.id}`)
			.expect(200);
		expect(status.body.samlSession?.readyToComplete).toBe(false);
	});

	it('API-AUTH-INT-53: logout with a valid session writes an end_user_logout audit row', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		const alice = await prisma.user.findFirst({ where: { username: 'alice' } });
		await prisma.auditEvent.deleteMany({ where: { event: 'end_user_logout' } });

		await agent.post(`${AUTH_API_PATH}/logout`).expect(200);

		let row = null;
		for (let attempt = 0; attempt < 30 && !row; attempt += 1) {
			row = await prisma.auditEvent.findFirst({ where: { event: 'end_user_logout' } });
			if (!row) {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		expect(row).not.toBeNull();
		expect(row?.actorType).toBe('end_user');
		expect(row?.actorId).toBe(alice!.id);
	});

	it('admin cookie and end-user cookie use different names', async () => {
		const adminRes = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const userRes = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);

		const adminCookies = Array.isArray(adminRes.headers['set-cookie'])
			? adminRes.headers['set-cookie']
			: [adminRes.headers['set-cookie']];
		const userCookies = Array.isArray(userRes.headers['set-cookie'])
			? userRes.headers['set-cookie']
			: [userRes.headers['set-cookie']];

		expect(adminCookies.some((c) => c?.includes(ADMIN_SESSION_COOKIE_NAME))).toBe(true);
		expect(userCookies.some((c) => c?.includes(END_USER_SESSION_COOKIE_NAME))).toBe(true);
		expect(ADMIN_SESSION_COOKIE_NAME).not.toBe(END_USER_SESSION_COOKIE_NAME);
	});
});
