import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
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
		user: { count: jest.fn().mockResolvedValue(0) },
		group: { count: jest.fn().mockResolvedValue(0) },
		role: { count: jest.fn().mockResolvedValue(0) },
		apiConnection: { count: jest.fn().mockResolvedValue(0) },
		spConnection: { count: jest.fn().mockResolvedValue(0) },
		adminUser: {
			findUnique: jest.fn(),
		},
	};

	beforeAll(async () => {
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

	it('GET /saml/metadata returns 501 stub', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(501);
		expect(response.body.status).toBe('not_implemented');
	});

	it('GET /saml/sso returns 501 stub', async () => {
		await request(app.getHttpServer() as App)
			.get('/saml/sso')
			.expect(501);
	});

	it('POST /saml/sso returns 501 stub', async () => {
		await request(app.getHttpServer() as App)
			.post('/saml/sso')
			.expect(501);
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

	it('GET /api/admin status remains stub with counts payload when authenticated', async () => {
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
		expect(response.body.status).toBe('stub');
		expect(response.body.apiConnectionsRoute).toContain('api-connections');
		expect(response.body.syncApiPath).toBe('/api/admin/sync');
	});

	it('GET /api/auth is separate from /api/admin', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
		const auth = await request(app.getHttpServer() as App)
			.get('/api/auth')
			.expect(200);
		expect(auth.body.module).toBe('auth');
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
