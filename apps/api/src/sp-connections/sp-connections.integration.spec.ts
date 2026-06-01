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
import { SP_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SpConnectionsModule } from './sp-connections.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';

jest.setTimeout(60_000);

describe('SP connections admin API (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'sp-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sp-admin-${randomUUID()}.db`);
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
				SpConnectionsModule,
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

	it('API-SAML-ADM-01: list without admin session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(SP_CONNECTIONS_API_PATH)
			.expect(401);
	});

	it('API-SAML-ADM-02: list returns seeded SP', async () => {
		const sp = await createTestSpConnection(prisma, { name: 'List Test SP' });
		const agent = await adminAgent();
		const res = await agent.get(SP_CONNECTIONS_API_PATH).expect(200);
		expect(res.body.items.some((item: { id: string }) => item.id === sp.id)).toBe(true);
	});

	it('API-SAML-ADM-03: get by id returns same shape', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = await adminAgent();
		const res = await agent.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).expect(200);
		expect(res.body.spEntityId).toBe(sp.spEntityId);
		expect(res.body.acsUrl).toBe(sp.acsUrl);
	});

	it('API-SAML-ADM-04: unknown id → 404', async () => {
		const agent = await adminAgent();
		await agent.get(`${SP_CONNECTIONS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`).expect(404);
	});

	it('API-SAML-ADM-05: metadata-url helper returns public URLs', async () => {
		const agent = await adminAgent();
		const res = await agent.get('/api/admin/idp/metadata-url').expect(200);
		expect(res.body.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(res.body.ssoUrl).toBe('http://localhost:3000/saml/sso');
		expect(res.body.entityId).toBe('http://localhost:3000');
	});

	it('API-SAML-ADM-06: list returns JSON not HTML', async () => {
		const agent = await adminAgent();
		const res = await agent.get(SP_CONNECTIONS_API_PATH);
		expect(res.headers['content-type']).toMatch(/application\/json/);
		expect(res.text).not.toContain('<!DOCTYPE html>');
	});

	it('API-SAML-ADM-07: list never exposes spCertificate secret', async () => {
		const sp = await createTestSpConnection(prisma, {
			spCertificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
		});
		const agent = await adminAgent();
		const res = await agent.get(SP_CONNECTIONS_API_PATH).expect(200);
		const item = res.body.items.find((row: { id: string }) => row.id === sp.id);
		expect(item.spCertificate).toBeUndefined();
		expect(item.hasSpCertificate).toBe(true);
	});

	it('API-SAML-ADM-08: attributeMapping JSON round-trips', async () => {
		const mapping = { attributes: [{ samlName: 'uid', source: 'username' }] };
		const sp = await createTestSpConnection(prisma, { attributeMapping: mapping });
		const agent = await adminAgent();
		const res = await agent.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).expect(200);
		expect(res.body.attributeMapping).toEqual(mapping);
	});
});
