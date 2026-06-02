import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AUTH_API_PATH, IDP_SETTINGS_API_PATH, SP_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { AdminModule } from '../src/admin/admin.module';
import { AdminAuthModule } from '../src/admin-auth/admin-auth.module';
import { AuthModule } from '../src/auth/auth.module';
import { HealthModule } from '../src/health/health.module';
import { IdentityModule } from '../src/identity/identity.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SamlModule } from '../src/saml/saml.module';
import { SpaModule } from '../src/spa/spa.module';

describe('Routing (e2e)', () => {
	let app: INestApplication;

	const prismaMock = {
		pingDatabase: jest.fn(),
		$disconnect: jest.fn(),
		user: {
			count: jest.fn().mockResolvedValue(0),
			findUnique: jest.fn(),
		},
		group: { count: jest.fn().mockResolvedValue(0) },
		role: { count: jest.fn().mockResolvedValue(0) },
		apiConnection: {
			count: jest.fn().mockResolvedValue(0),
			findFirst: jest.fn().mockResolvedValue(null),
		},
		spConnection: {
			count: jest.fn().mockResolvedValue(0),
			findUnique: jest.fn(),
			findMany: jest.fn().mockResolvedValue([]),
		},
		adminUser: {
			findUnique: jest.fn(),
		},
		samlSession: {
			findUnique: jest.fn(),
			create: jest.fn(),
			delete: jest.fn(),
			deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
		},
		idpSettings: {
			findUnique: jest.fn(),
			update: jest.fn(),
		},
	};

	beforeAll(async () => {
		const { encrypt } = await import('../src/encryption/encryption.util');
		const { getTestSigningMaterial } = await import('../src/prisma/test-fixtures');
		const { privateKeyPem, certPem } = getTestSigningMaterial('http://localhost:3000');
		const signingKeyEncrypted = encrypt(privateKeyPem, 'test-encryption-key-32chars!!');
		prismaMock.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			signingCertPem: certPem,
			signingKeyEncrypted,
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			rotationStartedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		prismaMock.idpSettings.update.mockImplementation(
			async (args: { data: Record<string, unknown> }) => ({
				id: 'default',
				entityId: 'http://localhost:3000',
				...args.data,
			}),
		);

		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [
						() => ({
							DATABASE_PROVIDER: 'sqlite',
							DATABASE_URL: 'file:../data/nestidp.db',
							SESSION_SECRET: 'test-session-secret',
							ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				HealthModule,
				PrismaModule,
				IdentityModule,
				(await import('../src/encryption/encryption.module')).EncryptionModule,
				AdminAuthModule,
				AdminModule,
				AuthModule,
				SamlModule,
				SpaModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaMock)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		prismaMock.adminUser.findUnique.mockResolvedValue(null);
	});

	it('GET /health returns 200 without database ping', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/health')
			.expect(200);
		expect(response.body).toEqual({ status: 'ok', service: 'nest-idp-api' });
		expect(prismaMock.pingDatabase).not.toHaveBeenCalled();
	});

	it('GET /ready returns 503 when database ping fails', async () => {
		prismaMock.pingDatabase.mockResolvedValue(false);
		const response = await request(app.getHttpServer() as App)
			.get('/ready')
			.expect(503);
		expect(response.body.database).toBe('disconnected');
	});

	it('GET /ready returns 200 when database ping succeeds', async () => {
		prismaMock.pingDatabase.mockResolvedValue(true);
		const response = await request(app.getHttpServer() as App)
			.get('/ready')
			.expect(200);
		expect(response.body.database).toBe('connected');
	});

	it('E2E-SAML-01: GET /saml/metadata returns 200 XML', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(response.headers['content-type']).toMatch(/xml/);
		expect(response.text).toContain('EntityDescriptor');
		expect(response.body?.status).not.toBe('not_implemented');
	});

	it('E2E-SAML-02: GET /saml/sso without SAMLRequest returns 400', async () => {
		await request(app.getHttpServer() as App)
			.get('/saml/sso')
			.expect(400);
	});

	it('E2E-SAML-03: POST /saml/sso returns 405', async () => {
		await request(app.getHttpServer() as App)
			.post('/saml/sso')
			.expect(405);
	});

	it('GET /api/admin without session returns 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
	});

	it('GET /api/admin/api-connections without session returns 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin/api-connections')
			.expect(401);
	});

	it('API-SYNC-E2E-01: POST /api/admin/sync/:id without auth returns 401', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/sync/clxxxxxxxxxxxxxxxxxxxxxxxxx')
			.expect(401);
	});

	it('API-SYNC-E2E-02: GET /api/admin/sync/:id/status without auth returns 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin/sync/clxxxxxxxxxxxxxxxxxxxxxxxxx/status')
			.expect(401);
	});

	it('API-SYNC-E2E-03: GET /api/admin/sync/:id/status returns JSON not SPA HTML', async () => {
		const response = await request(app.getHttpServer() as App).get(
			'/api/admin/sync/clxxxxxxxxxxxxxxxxxxxxxxxxx/status',
		);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.text).not.toContain('<!DOCTYPE html>');
		expect(response.status).toBe(401);
	});

	it('GET /api/admin returns counts when authenticated via session cookie', async () => {
		prismaMock.user.count.mockResolvedValue(5);
		prismaMock.group.count.mockResolvedValue(2);
		prismaMock.role.count.mockResolvedValue(1);
		prismaMock.apiConnection.count.mockResolvedValue(3);
		prismaMock.spConnection.count.mockResolvedValue(4);

		const password = 'e2e-admin-password';
		const { hashPassword } = await import('../src/admin-auth/password.util');
		const passwordHash = await hashPassword(password);
		prismaMock.adminUser.findUnique.mockImplementation(
			async (args: { where: { username?: string; id?: string } }) => {
				if (args.where.username === 'admin') {
					return { id: 'admin-1', username: 'admin', passwordHash };
				}
				if (args.where.id === 'admin-1') {
					return { id: 'admin-1', username: 'admin', passwordHash };
				}
				return null;
			},
		);

		const agent = request.agent(app.getHttpServer() as App);
		await agent.post('/api/admin/auth/login').send({ username: 'admin', password }).expect(200);

		const response = await agent.get('/api/admin').expect(200);
		expect(response.body.counts).toEqual({
			users: 5,
			groups: 2,
			roles: 1,
			apiConnections: 3,
			spConnections: 4,
		});
	});

	it('E2E-ADM-08-01: GET /api/admin returns dashboard DTO when authenticated', async () => {
		const password = 'e2e-admin-password-2';
		const { hashPassword } = await import('../src/admin-auth/password.util');
		const passwordHash = await hashPassword(password);
		prismaMock.adminUser.findUnique.mockImplementation(
			async (args: { where: { username?: string; id?: string } }) => {
				if (args.where.username === 'admin2') {
					return { id: 'admin-2', username: 'admin2', passwordHash };
				}
				if (args.where.id === 'admin-2') {
					return { id: 'admin-2', username: 'admin2', passwordHash };
				}
				return null;
			},
		);

		const agent = request.agent(app.getHttpServer() as App);
		await agent.post('/api/admin/auth/login').send({ username: 'admin2', password }).expect(200);

		const response = await agent.get('/api/admin').expect(200);
		expect(response.body.counts).toBeDefined();
		expect(response.body.apiConnectionsRoute).toContain('api-connections');
		expect(response.body.syncApiPath).toBe('/api/admin/sync');
		expect(response.body.entityId).toBe('http://localhost:3000');
		expect(response.body.metadataUrl).toContain('/saml/metadata');
		expect(response.body.idp).toBeDefined();
		expect(response.body.idp.idpSettingsRoute).toBe('/admin/settings/idp');
	});

	it('E2E-ADM-08-02: GET /api/admin/sp-connections returns JSON with admin cookie', async () => {
		const password = 'e2e-sp-admin-pass';
		const { hashPassword } = await import('../src/admin-auth/password.util');
		const passwordHash = await hashPassword(password);
		prismaMock.adminUser.findUnique.mockImplementation(
			async (args: { where: { username?: string; id?: string } }) => {
				if (args.where.username === 'spadmin') {
					return { id: 'admin-sp', username: 'spadmin', passwordHash };
				}
				if (args.where.id === 'admin-sp') {
					return { id: 'admin-sp', username: 'spadmin', passwordHash };
				}
				return null;
			},
		);
		prismaMock.spConnection.findMany.mockResolvedValue([
			{
				id: 'sp-1',
				name: 'App',
				spEntityId: 'urn:sp:app',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				attributeMapping: null,
				active: true,
				spCertificate: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		const agent = request.agent(app.getHttpServer() as App);
		await agent.post('/api/admin/auth/login').send({ username: 'spadmin', password }).expect(200);

		const response = await agent.get(SP_CONNECTIONS_API_PATH).expect(200);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body.items).toHaveLength(1);
		expect(response.text).not.toContain('<!DOCTYPE html>');
	});

	it('E2E-ADM-08-05: GET /api/admin/sp-connections without session returns 401 JSON', async () => {
		const response = await request(app.getHttpServer() as App).get(SP_CONNECTIONS_API_PATH);
		expect(response.status).toBe(401);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body?.module).not.toBe('admin');
	});

	it('GET /api/auth/session is separate from /api/admin', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
		const auth = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session`)
			.expect(200);
		expect(auth.body.authenticated).toBe(false);
	});

	it('E2E-AUTH-01: POST /api/admin/auth/login with wrong password returns 401', async () => {
		const password = 'e2e-wrong-pass-test';
		const { hashPassword } = await import('../src/admin-auth/password.util');
		const passwordHash = await hashPassword(password);
		prismaMock.adminUser.findUnique.mockImplementation(
			async (args: { where: { username?: string } }) => {
				if (args.where.username === 'admin') {
					return { id: 'admin-1', username: 'admin', passwordHash };
				}
				return null;
			},
		);

		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'not-the-password' })
			.expect(401);
	});

	it('E2E-AUTH-02: POST /api/admin/auth/login with empty body returns 400', async () => {
		await request(app.getHttpServer() as App)
			.post('/api/admin/auth/login')
			.send({})
			.expect(400);
	});

	it('E2E-AUTH-03: POST /api/admin/auth/logout returns ok without session', async () => {
		const response = await request(app.getHttpServer() as App)
			.post('/api/admin/auth/logout')
			.expect(200);
		expect(response.body).toEqual({ ok: true });
	});

	it('API-AUTH-E2E-01: POST /api/auth/login without synced user returns 401', async () => {
		prismaMock.user.findUnique.mockResolvedValue(null);
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'nobody', password: 'any' })
			.expect(401);
		expect(response.body.message).toBe('Invalid username or password');
	});

	it('API-AUTH-E2E-02: POST /api/auth/login with empty body returns 400', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({})
			.expect(400);
	});

	it('API-AUTH-E2E-03: GET /api/auth/me without session returns 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/me`)
			.expect(401);
	});

	it('API-AUTH-E2E-04: POST /api/auth/logout returns ok without session', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/logout`)
			.expect(200);
		expect(response.body).toEqual({ ok: true });
	});

	it('API-AUTH-E2E-05: GET /api/auth/session returns JSON not SPA HTML', async () => {
		const response = await request(app.getHttpServer() as App).get(`${AUTH_API_PATH}/session`);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.text).not.toContain('<!DOCTYPE html>');
		expect(response.status).toBe(200);
	});

	it('E2E-SAML-05: POST /api/auth/login/complete-sso without cookie returns 401', async () => {
		const response = await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx' })
			.expect(401);
		expect(response.headers['content-type']).toMatch(/application\/json/);
	});

	it('E2E-SAML-06: GET /api/auth/session still returns JSON', async () => {
		const response = await request(app.getHttpServer() as App)
			.get(`${AUTH_API_PATH}/session`)
			.expect(200);
		expect(response.headers['content-type']).toMatch(/application\/json/);
	});

	it('GET /admin does not hit admin API controller (no JSON stub)', async () => {
		const response = await request(app.getHttpServer() as App).get('/admin');
		expect(response.status).not.toBe(200);
		expect(response.body?.module).not.toBe('admin');
	});

	it('GET /login returns SPA fallback not SAML endpoint', async () => {
		const response = await request(app.getHttpServer() as App).get('/login');
		expect(response.status).not.toBe(501);
		expect(response.body?.endpoint).not.toBe('/saml/sso');
	});

	it('GET /admin/api-connections returns SPA fallback for nested admin route', async () => {
		const response = await request(app.getHttpServer() as App).get('/admin/api-connections');
		expect(response.body?.module).not.toBe('admin');
	});

	it('E2E-IDP-09-01: GET /api/admin/idp/settings without session returns 401 JSON', async () => {
		const response = await request(app.getHttpServer() as App).get(IDP_SETTINGS_API_PATH);
		expect(response.status).toBe(401);
		expect(response.headers['content-type']).toMatch(/application\/json/);
	});

	it('E2E-IDP-09-02: GET /api/admin/idp/settings with admin cookie returns JSON DTO', async () => {
		const password = 'e2e-idp-settings-pass';
		const { hashPassword } = await import('../src/admin-auth/password.util');
		const passwordHash = await hashPassword(password);
		prismaMock.adminUser.findUnique.mockImplementation(
			async (args: { where: { username?: string; id?: string } }) => {
				if (args.where.username === 'idpadmin') {
					return { id: 'admin-idp', username: 'idpadmin', passwordHash };
				}
				if (args.where.id === 'admin-idp') {
					return { id: 'admin-idp', username: 'idpadmin', passwordHash };
				}
				return null;
			},
		);

		const agent = request.agent(app.getHttpServer() as App);
		await agent.post('/api/admin/auth/login').send({ username: 'idpadmin', password }).expect(200);

		const response = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body.entityId).toBe('http://localhost:3000');
		expect(response.body.rotation).toBeDefined();
		expect(response.text).not.toContain('<!DOCTYPE html>');
	});

	it('E2E-IDP-09-03: GET /admin/settings/idp returns SPA fallback not admin API JSON', async () => {
		const response = await request(app.getHttpServer() as App).get('/admin/settings/idp');
		expect(response.body?.module).not.toBe('admin');
		expect(response.text).not.toContain('"entityId"');
	});

	it('E2E-IDP-09-04: GET /saml/metadata still public without admin session', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(response.headers['content-type']).toMatch(/xml/);
	});

	it('E2E-IDP-09-05: GET /admin/settings/unknown returns SPA fallback for nested settings route', async () => {
		const response = await request(app.getHttpServer() as App).get('/admin/settings/unknown');
		expect(response.body?.module).not.toBe('admin');
	});

	it('GET /saml/unknown returns 404 not SPA fallback', async () => {
		await request(app.getHttpServer() as App)
			.get('/saml/unknown')
			.expect(404);
	});
});

describe('Ready edge cases (e2e)', () => {
	let app: INestApplication;
	const prismaMock = { pingDatabase: jest.fn(), $disconnect: jest.fn() };

	beforeAll(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [() => ({ DATABASE_URL: '' })],
				}),
				HealthModule,
				PrismaModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaMock)
			.compile();

		app = moduleFixture.createNestApplication();
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	it('GET /ready returns 503 not_configured when DATABASE_URL is empty', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/ready')
			.expect(503);
		expect(response.body.database).toBe('not_configured');
		expect(prismaMock.pingDatabase).not.toHaveBeenCalled();
	});
});
