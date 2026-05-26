import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AdminModule } from '../src/admin/admin.module';
import { AuthModule } from '../src/auth/auth.module';
import { HealthModule } from '../src/health/health.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { SamlModule } from '../src/saml/saml.module';
import { SpaModule } from '../src/spa/spa.module';

describe('Routing (e2e)', () => {
	let app: INestApplication;

	const prismaMock = {
		pingDatabase: jest.fn(),
		$disconnect: jest.fn(),
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
							ENCRYPTION_KEY: 'test-encryption-key',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				HealthModule,
				PrismaModule,
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
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
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

	it('GET /api/admin is under /api/admin not global /api only', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(200);
		expect(response.body.module).toBe('admin');
	});

	it('GET /api/auth is separate from /api/admin', async () => {
		const admin = await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(200);
		const auth = await request(app.getHttpServer() as App)
			.get('/api/auth')
			.expect(200);
		expect(admin.body.module).toBe('admin');
		expect(auth.body.module).toBe('auth');
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
