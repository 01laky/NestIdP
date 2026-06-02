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
import { API_CONNECTION_ROUTE_PREFIX, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminModule } from './admin.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	createTestUser,
	getTestSigningMaterialWithDays,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';

jest.setTimeout(60_000);

describe('Admin dashboard API (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'dash-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-admin-dash-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');
		const prismaService = new PrismaService({ datasources: { db: { url: databaseUrl } } });
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
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	async function adminAgent(): Promise<request.Agent> {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return agent;
	}

	it('API-ADM-DASH-01: GET /api/admin without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get('/api/admin')
			.expect(401);
	});

	it('API-ADM-DASH-02: dashboard returns counts and routes', async () => {
		const conn = await createTestApiConnection(prisma);
		await createTestUser(prisma, conn.id);
		await createTestSpConnection(prisma);
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.counts.users).toBeGreaterThanOrEqual(1);
		expect(res.body.counts.spConnections).toBeGreaterThanOrEqual(1);
		expect(res.body.apiConnectionsRoute).toBe(API_CONNECTION_ROUTE_PREFIX);
		expect(res.body.spConnectionsRoute).toBe(SP_CONNECTION_ROUTE_PREFIX);
		expect(res.body.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(res.body.entityId).toBe('http://localhost:3000');
	});

	it('API-ADM-DASH-03: includes apiConnection when configured', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.apiConnection).not.toBeNull();
		expect(res.body.apiConnection.name).toBeTruthy();
	});

	it('API-ADM-DASH-04: never exposes bearer token or encrypted credentials', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.apiConnection?.bearerToken).toBeUndefined();
		expect(res.body.apiConnection?.authCredentialsEncrypted).toBeUndefined();
	});

	it('API-ADM-DASH-05: response has no legacy stub fields', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.status).toBeUndefined();
		expect(res.body.module).toBeUndefined();
		expect(res.body.note).toBeUndefined();
	});

	it('API-ADM-DASH-06: identityUsersRoute and spConnectionsRoute differ', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.identityUsersRoute).toContain('identity');
		expect(res.body.spConnectionsRoute).toContain('sp-connections');
		expect(res.body.identityUsersRoute).not.toContain('sp-connections');
	});

	it('API-ADM-DASH-07: lastSyncStatus and lastSyncAt from api connection row', async () => {
		const finishedAt = new Date('2026-03-01T10:00:00.000Z');
		await prisma.apiConnection.updateMany({
			data: { lastSyncStatus: 'SUCCESS', lastSyncAt: finishedAt },
		});
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.lastSyncStatus).toBe('SUCCESS');
		expect(res.body.lastSyncAt).toBe(finishedAt.toISOString());
	});

	it('API-ADM-DASH-08: ssoUrl and syncApiPath present on dashboard', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.ssoUrl).toBe('http://localhost:3000/saml/sso');
		expect(res.body.syncApiPath).toBe('/api/admin/sync');
		expect(res.body.spConnectionsApiPath).toContain('sp-connections');
	});

	it('API-ADM-DASH-09: dashboard includes idp status object', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.idp).toMatchObject({
			idpSettingsRoute: '/admin/settings/idp',
			hasSigningCertificate: true,
			rotationActive: false,
			certStatus: expect.stringMatching(/^(missing|ok|expiring_soon|rotation_active)$/),
		});
	});

	it('API-ADM-DASH-10: idp.certStatus ok when signing cert configured', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.idp.certStatus).toBe('ok');
		expect(res.body.idp.hasSigningCertificate).toBe(true);
	});

	it('API-ADM-DASH-11: idp.signingCertNotAfter is ISO string or null', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		if (res.body.idp.signingCertNotAfter) {
			expect(res.body.idp.signingCertNotAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		} else {
			expect(res.body.idp.signingCertNotAfter).toBeNull();
		}
	});

	it('API-ADM-DASH-12: dashboard JSON never exposes signing key material', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		const serialized = JSON.stringify(res.body);
		expect(serialized).not.toContain('BEGIN PRIVATE KEY');
		expect(serialized).not.toContain('signingKeyEncrypted');
	});

	it('API-ADM-DASH-13: idp.rotationActive true when pending cert exists', async () => {
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: settings!.signingCertPem,
				pendingSigningKeyEncrypted: settings!.signingKeyEncrypted,
				rotationStartedAt: new Date(),
			},
		});
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.idp.rotationActive).toBe(true);
		expect(res.body.idp.certStatus).toBe('rotation_active');
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
	});

	it('API-ADM-DASH-14: idp.certStatus missing when no primary cert configured', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: null,
				signingKeyEncrypted: null,
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.idp.certStatus).toBe('missing');
		expect(res.body.idp.hasSigningCertificate).toBe(false);
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
	});

	it('API-ADM-DASH-15: idp.certStatus expiring_soon when cert notAfter within 30 days', async () => {
		const { certPem, privateKeyPem } = getTestSigningMaterialWithDays('http://localhost:3000', 15);
		const { encrypt } = await import('../encryption/encryption.util');
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: certPem,
				signingKeyEncrypted: encrypt(privateKeyPem, 'test-encryption-key-32chars!!'),
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
		const agent = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.idp.certStatus).toBe('expiring_soon');
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
	});
});
