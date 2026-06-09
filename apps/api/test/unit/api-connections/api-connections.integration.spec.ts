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
import { ADMIN_CSRF_HEADER_NAME, API_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { AdminModule } from '@api/admin/admin.module';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { IdentityModule } from '@api/identity/identity.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestGroup,
	createTestSyncLog,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(60_000);

describe('api-connections integration (SQLite)', () => {
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

	function createConnection(
		agent: ReturnType<typeof request.agent>,
		csrf: string,
		overrides: Record<string, string> = {},
	) {
		return agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret-token-value',
				...overrides,
			});
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-api-con-${randomUUID()}.db`);
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
		await prisma.syncLog.deleteMany();
		await prisma.group.deleteMany();
		await prisma.role.deleteMany();
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

	it('API-CON-INT-01: Login → create connection → GET list contains it', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret-token-value',
			})
			.expect(201);

		const list = await agent.get(API_CONNECTIONS_API_PATH).expect(200);
		expect(list.body.connections).toHaveLength(1);
		expect(list.body.connections[0].name).toBe('Corp API');
	});

	it('API-CON-INT-02: Create → GET by id → same fields (no token in response)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret-token-value',
			})
			.expect(201);

		const id = created.body.connection.id as string;
		const fetched = await agent.get(`${API_CONNECTIONS_API_PATH}/${id}`).expect(200);

		expect(fetched.body.connection).toMatchObject({
			id,
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			hasBearerToken: true,
		});
		expect(fetched.body.connection).not.toHaveProperty('bearerToken');
		expect(fetched.body.connection).not.toHaveProperty('authCredentialsEncrypted');
	});

	it('API-CON-INT-03: Create → PATCH name → updated', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		const id = created.body.connection.id as string;
		const updated = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'Renamed API' })
			.expect(200);

		expect(updated.body.connection.name).toBe('Renamed API');
	});

	it('API-CON-INT-04: Create → PATCH bearerToken → still hasBearerToken true', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'old-token',
			})
			.expect(201);

		const id = created.body.connection.id as string;
		const updated = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(csrf))
			.send({ bearerToken: 'new-token' })
			.expect(200);

		expect(updated.body.connection.hasBearerToken).toBe(true);
	});

	it('API-CON-INT-05: Create → DELETE → GET 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		const id = created.body.connection.id as string;
		await agent.delete(`${API_CONNECTIONS_API_PATH}/${id}`).set(csrfHeader(csrf)).expect(200);
		await agent.get(`${API_CONNECTIONS_API_PATH}/${id}`).expect(404);
	});

	it('API-CON-INT-06 / MAS: a second external connection is allowed (Prompt 37 multi-source)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'First',
				baseUrl: 'https://a.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Second',
				baseUrl: 'https://b.example.com',
				bearerToken: 'secret',
			})
			.expect(201);
	});

	it('API-CON-INT-07: POST create without CSRF header → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(403);
	});

	it('API-CON-INT-08: Unauthenticated GET → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(API_CONNECTIONS_API_PATH)
			.expect(401);
	});

	it('API-CON-INT-09: Delete connection with synced user → 409', async () => {
		const connection = await createTestApiConnection(prisma, {
			bearerToken: 'fixture-token',
		});
		await createTestUser(prisma, connection.id);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.delete(`${API_CONNECTIONS_API_PATH}/${connection.id}`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-CON-INT-10: Encrypted value in DB ≠ plaintext token', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const plaintext = 'my-plaintext-bearer-token';

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: plaintext,
			})
			.expect(201);

		const row = await prisma.apiConnection.findUnique({
			where: { id: created.body.connection.id },
		});
		expect(row!.authCredentialsEncrypted).not.toBe(plaintext);
		expect(row!.authCredentialsEncrypted.startsWith('v1:')).toBe(true);
	});

	it('API-CON-INT-11: 404 responses match ApiErrorResponseDto shape', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const response = await agent
			.get(`${API_CONNECTIONS_API_PATH}/c1234567890123456789012345`)
			.expect(404);
		expect(response.body).toMatchObject({
			statusCode: 404,
			message: expect.any(String),
		});
	});

	it('API-CON-INT-12: POST /:id/test with mocked fetch 200 → test response ok true', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);

		const testRes = await agent
			.post(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}/test`)
			.set(csrfHeader(csrf))
			.expect(200);

		expect(testRes.body).toMatchObject({ ok: true, reachable: true, statusCode: 200 });
	});

	it('API-CON-INT-13: Re-login → new CSRF works; stale CSRF rejected on PATCH', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const staleCsrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(staleCsrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		const id = created.body.connection.id as string;
		const freshCsrf = await loginAgent(agent);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(staleCsrf))
			.send({ name: 'Should fail' })
			.expect(403);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(freshCsrf))
			.send({ name: 'Updated name' })
			.expect(200);
	});

	it('API-ADM-08: After create API connection → GET /api/admin counts incremented', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const before = await agent.get('/api/admin').expect(200);
		expect(before.body.counts.apiConnections).toBe(0);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		const after = await agent.get('/api/admin').expect(200);
		expect(after.body.counts.apiConnections).toBe(1);
		expect(after.body.apiConnectionsApiPath).toBe(API_CONNECTIONS_API_PATH);
	});

	it('API-ADM-09: After delete empty connection → counts decremented', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(201);

		await agent
			.delete(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader(csrf))
			.expect(200);

		const after = await agent.get('/api/admin').expect(200);
		expect(after.body.counts.apiConnections).toBe(0);
	});

	it('API-CON-INT-14: POST with extra field → 400 forbidNonWhitelisted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Corp',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
				bogusUnknownField: 'x',
			})
			.expect(400);
	});

	it('API-CON-INT-15: POST empty name → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await createConnection(agent, csrf, { name: '   ' }).expect(400);
	});

	it('API-CON-INT-16: POST invalid baseUrl → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await createConnection(agent, csrf, { baseUrl: 'not-a-valid-url' }).expect(400);
	});

	it('API-CON-INT-17: POST baseUrl with embedded credentials → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await createConnection(agent, csrf, {
			baseUrl: 'https://user:pass@identity.example.com',
		}).expect(400);
	});

	it('API-CON-INT-18: PATCH rename to duplicate name case-insensitive → 409', async () => {
		const first = await createTestApiConnection(prisma, {
			name: 'First API',
			bearerToken: 'token-a',
		});
		const second = await createTestApiConnection(prisma, {
			name: 'Second API',
			baseUrl: 'https://second.example.com',
			authCredentialsEncrypted: 'enc-b',
		});

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${second.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'first api' })
			.expect(409);

		expect(first.id).not.toBe(second.id);
	});

	it('API-CON-INT-19: PATCH without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.send({ name: 'Hacked' })
			.expect(403);
	});

	it('API-CON-INT-20: DELETE without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent.delete(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`).expect(403);
	});

	it('API-CON-INT-21: PATCH with wrong CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader('wrong-csrf-token-value'))
			.send({ name: 'Renamed' })
			.expect(403);
	});

	it('API-CON-INT-22: invalid id format → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.get(`${API_CONNECTIONS_API_PATH}/not-a-cuid`).expect(400);
	});

	it('API-CON-TST-05: POST test without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent.post(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}/test`).expect(403);
	});

	it('API-CON-INT-24: POST test external 401 → ok false reachable', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 401 } as Response);

		const testRes = await agent
			.post(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}/test`)
			.set(csrfHeader(csrf))
			.expect(200);

		expect(testRes.body).toMatchObject({
			ok: false,
			reachable: true,
			statusCode: 401,
		});
	});

	it('API-CON-INT-25: POST test network failure → ok false unreachable', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		const testRes = await agent
			.post(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}/test`)
			.set(csrfHeader(csrf))
			.expect(200);

		expect(testRes.body).toMatchObject({ ok: false, reachable: false });
	});

	it('API-CON-INT-26: test does not update lastSyncAt or lastSyncStatus', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);
		const id = created.body.connection.id as string;

		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);

		await agent.post(`${API_CONNECTIONS_API_PATH}/${id}/test`).set(csrfHeader(csrf)).expect(200);

		const row = await prisma.apiConnection.findUnique({ where: { id } });
		expect(row!.lastSyncAt).toBeNull();
		expect(row!.lastSyncStatus).toBe('NEVER');
		expect(await prisma.syncLog.count()).toBe(0);
	});

	it('API-CON-INT-27: PATCH empty body → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(400);
	});

	it('API-CON-INT-28: PATCH empty bearerToken → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader(csrf))
			.send({ bearerToken: '' })
			.expect(400);
	});

	it('API-CON-INT-29: DELETE with Group child → 409', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 't' });
		await createTestGroup(prisma, connection.id);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.delete(`${API_CONNECTIONS_API_PATH}/${connection.id}`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-CON-INT-30: DELETE with SyncLog child → 409', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 't' });
		await createTestSyncLog(prisma, connection.id);

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.delete(`${API_CONNECTIONS_API_PATH}/${connection.id}`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-CON-INT-31: create response JSON never contains secret fields', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const created = await createConnection(agent, csrf, {
			bearerToken: 'must-not-appear-in-json',
		}).expect(201);

		expect(JSON.stringify(created.body)).not.toContain('must-not-appear-in-json');
		expect(created.body.connection).not.toHaveProperty('authCredentialsEncrypted');
	});

	it('API-CON-INT-32: unauthenticated POST create → 401', async () => {
		await request(app.getHttpServer() as App)
			.post(API_CONNECTIONS_API_PATH)
			.send({
				name: 'Corp',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'secret',
			})
			.expect(401);
	});

	it('API-CON-INT-33: PATCH baseUrl normalizes trailing slash', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		const updated = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader(csrf))
			.send({ baseUrl: 'https://api.example.com/v1/' })
			.expect(200);

		expect(updated.body.connection.baseUrl).toBe('https://api.example.com/v1');
	});

	// --- Outbound proxy (Prompt 33) end-to-end ----------------------------------------------------

	it('PROXY-INT-01: create with proxy → DTO exposes non-secret state, password never returned', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPassword: 'psecret',
			noProxyHosts: '.corp.example, 10.0.0.0/8',
		} as never).expect(201);

		const c = created.body.connection;
		expect(c).toMatchObject({
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			hasProxyPassword: true,
			noProxyHosts: '.corp.example, 10.0.0.0/8',
			lastProxyCheckStatus: null,
		});
		expect(c).not.toHaveProperty('proxyPassword');
		expect(c).not.toHaveProperty('proxyPasswordEncrypted');
		expect(JSON.stringify(c)).not.toContain('psecret');
	});

	it('PROXY-INT-02: proxy password is encrypted at rest in the DB (≠ plaintext, v1: prefix)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPassword: 'plain-proxy-secret',
		} as never).expect(201);

		const row = await prisma.apiConnection.findUnique({
			where: { id: created.body.connection.id },
		});
		expect(row!.proxyPasswordEncrypted).not.toBeNull();
		expect(row!.proxyPasswordEncrypted).not.toBe('plain-proxy-secret');
		expect(row!.proxyPasswordEncrypted!.startsWith('v1:')).toBe(true);
	});

	it('PROXY-INT-03: proxyEnabled=true without proxyUrl → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await createConnection(agent, csrf, { proxyEnabled: true } as never).expect(400);
	});

	it('PROXY-INT-04: invalid proxy URL scheme → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'socks5://proxy:1080',
		} as never).expect(400);
	});

	it('PROXY-INT-05: inline credentials in proxy URL → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://user:pass@proxy:8080',
		} as never).expect(400);
	});

	it('PROXY-INT-06: PATCH omits proxyPassword keeps stored; explicit null clears it', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPassword: 'psecret',
		} as never).expect(201);
		const id = created.body.connection.id;

		// omit password → kept
		const renamed = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(csrf))
			.send({ proxyUsername: 'puser2' })
			.expect(200);
		expect(renamed.body.connection.hasProxyPassword).toBe(true);
		expect(renamed.body.connection.proxyUsername).toBe('puser2');

		// explicit null → cleared
		const cleared = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${id}`)
			.set(csrfHeader(csrf))
			.send({ proxyPassword: null })
			.expect(200);
		expect(cleared.body.connection.hasProxyPassword).toBe(false);
		const row = await prisma.apiConnection.findUnique({ where: { id } });
		expect(row!.proxyPasswordEncrypted).toBeNull();
	});

	it('PROXY-INT-07: a proxy-only PATCH is accepted (not "at least one field")', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		const updated = await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.set(csrfHeader(csrf))
			.send({ noProxyHosts: '.internal' })
			.expect(200);
		expect(updated.body.connection.noProxyHosts).toBe('.internal');
	});

	it('PROXY-INT-08: empty proxyPassword string → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy:8080',
			proxyPassword: '',
		} as never).expect(400);
	});

	it('PROXY-INT-09: POST /:id/test-proxy is a no-op (bypassed) when proxy is off', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf).expect(201);

		const res = await agent
			.post(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}/test-proxy`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toMatchObject({
			ok: true,
			status: 'bypassed',
			bypassed: true,
			viaProxy: false,
		});
	});

	it('PROXY-INT-10: test-proxy reports ok via a mocked proxied fetch + persists lastProxyCheckStatus', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
		} as never).expect(201);
		const id = created.body.connection.id;

		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);
		const res = await agent
			.post(`${API_CONNECTIONS_API_PATH}/${id}/test-proxy`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toMatchObject({ ok: true, status: 'ok', viaProxy: true });
		expect(JSON.stringify(res.body)).not.toMatch(/psecret|proxyPasswordEncrypted/);

		const row = await prisma.apiConnection.findUnique({ where: { id } });
		expect(row!.lastProxyCheckStatus).toBe('ok');
		expect(row!.lastProxyCheckAt).not.toBeNull();
	});

	it('PROXY-INT-11: extra unknown proxy field → 400 forbidNonWhitelisted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await createConnection(agent, csrf, { proxyBogus: 'x' } as never).expect(400);
	});

	it('PROXY-INT-12: GET by id round-trips the stored proxy config (no secret)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const created = await createConnection(agent, csrf, {
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPassword: 'psecret',
			noProxyHosts: '.corp.example',
		} as never).expect(201);

		const fetched = await agent
			.get(`${API_CONNECTIONS_API_PATH}/${created.body.connection.id}`)
			.expect(200);
		expect(fetched.body.connection).toMatchObject({
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			hasProxyPassword: true,
			noProxyHosts: '.corp.example',
		});
		expect(JSON.stringify(fetched.body)).not.toContain('psecret');
	});
});
