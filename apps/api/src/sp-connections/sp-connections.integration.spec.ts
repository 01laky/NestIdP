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
	ADMIN_CSRF_HEADER_NAME,
	SAML_REQUEST_QUERY_PARAM,
	SP_CONNECTIONS_API_PATH,
} from '@nestidp/shared';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { SamlModule } from '../saml/saml.module';
import { SpConnectionsModule } from './sp-connections.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	buildTestAuthnRequestRedirectPayload,
	createTestAdminUserWithPassword,
	createTestIdpSettingsWithSigningKey,
	createTestSamlSession,
	createTestSpConnection,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';

jest.setTimeout(60_000);

const VALID_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

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
							SAML_SESSION_CLEANUP_INTERVAL_MS: 0,
						}),
					],
				}),
				PrismaModule,
				EncryptionModule,
				AdminAuthModule,
				SamlModule,
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

	async function loginCsrf(agent: request.Agent): Promise<string> {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return login.body.csrfToken as string;
	}

	async function adminAgent(): Promise<request.Agent> {
		const agent = request.agent(app.getHttpServer() as App);
		await loginCsrf(agent);
		return agent;
	}

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
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

	it('API-SPC-01: POST without CSRF → 403', async () => {
		const agent = await adminAgent();
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.send({
				name: 'No CSRF',
				spEntityId: 'urn:sp:nocsrf',
				acsUrl: 'https://sp.example.com/acs',
			})
			.expect(403);
	});

	it('API-SPC-02: POST creates SP with 201', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Created SP',
				spEntityId: 'urn:sp:created',
				acsUrl: 'https://sp.example.com/acs/new',
				active: true,
			})
			.expect(201);
		expect(res.body.item.name).toBe('Created SP');
		expect(res.body.item.spEntityId).toBe('urn:sp:created');
	});

	it('API-SPC-03: duplicate name → 409', async () => {
		await createTestSpConnection(prisma, { name: 'Dup Name' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Dup Name',
				spEntityId: 'urn:sp:dup-name',
				acsUrl: 'https://sp.example.com/acs/dup',
			})
			.expect(409);
	});

	it('API-SPC-04: PATCH updates acsUrl', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ acsUrl: 'https://sp.example.com/acs/updated' })
			.expect(200);
		expect(res.body.item.acsUrl).toBe('https://sp.example.com/acs/updated');
	});

	it('API-SPC-05: DELETE removes SP', async () => {
		const sp = await createTestSpConnection(prisma, { active: false });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent.delete(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).set(csrfHeader(csrf)).expect(200);
		await agent.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).expect(404);
	});

	it('API-SPC-06: invalid acsUrl on create → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Bad ACS',
				spEntityId: 'urn:sp:bad-acs',
				acsUrl: 'not-a-url',
			})
			.expect(400);
	});

	it('API-SPC-07: test-acs returns structured response', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${SP_CONNECTIONS_API_PATH}/${sp.id}/test-acs`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toMatchObject({
			ok: expect.any(Boolean),
			reachable: expect.any(Boolean),
			message: expect.any(String),
		});
	});

	it('API-SPC-08: duplicate spEntityId → 409', async () => {
		const sp = await createTestSpConnection(prisma, { spEntityId: 'urn:sp:dup-entity' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Other Name',
				spEntityId: sp.spEntityId,
				acsUrl: 'https://sp.example.com/acs/other',
			})
			.expect(409);
	});

	it('API-SPC-09: PATCH empty body → 400', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(400);
	});

	it('API-SPC-10: PATCH without CSRF → 403', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = await adminAgent();
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.send({ name: 'No CSRF Patch' })
			.expect(403);
	});

	it('API-SPC-11: DELETE without CSRF → 403', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = await adminAgent();
		await agent.delete(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).expect(403);
	});

	it('API-SPC-12: invalid attributeMapping → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Bad Mapping',
				spEntityId: 'urn:sp:bad-map',
				acsUrl: 'https://sp.example.com/acs',
				attributeMapping: { attributes: [{ samlName: '', source: 'email' }] },
			})
			.expect(400);
	});

	it('API-SPC-13: invalid spCertificate → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Bad Cert',
				spEntityId: 'urn:sp:bad-cert',
				acsUrl: 'https://sp.example.com/acs',
				spCertificate: 'not-pem',
			})
			.expect(400);
	});

	it('API-SPC-14: invalid nameIdFormat → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Bad Format',
				spEntityId: 'urn:sp:bad-fmt',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: 'not-a-urn',
			})
			.expect(400);
	});

	it('API-SPC-15: case-insensitive duplicate name → 409', async () => {
		await createTestSpConnection(prisma, { name: 'MyApp' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'myapp',
				spEntityId: 'urn:sp:case-name',
				acsUrl: 'https://sp.example.com/acs',
			})
			.expect(409);
	});

	it('API-SPC-16: GET by id never returns spCertificate field', async () => {
		const sp = await createTestSpConnection(prisma, {
			spCertificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
		});
		const agent = await adminAgent();
		const res = await agent.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).expect(200);
		expect(res.body.spCertificate).toBeUndefined();
		expect(res.body.hasSpCertificate).toBe(true);
	});

	it('API-SPC-17: unknown id PATCH → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.set(csrfHeader(csrf))
			.send({ name: 'Ghost' })
			.expect(404);
	});

	it('API-SPC-18: test-acs unknown id → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${SP_CONNECTIONS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx/test-acs`)
			.set(csrfHeader(csrf))
			.expect(404);
	});

	it('API-SPC-19: invalid cuid id → 400', async () => {
		const agent = await adminAgent();
		await agent.get(`${SP_CONNECTIONS_API_PATH}/not-a-cuid`).expect(400);
	});

	it('API-SPC-20: forbidNonWhitelisted field on create → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Extra',
				spEntityId: 'urn:sp:extra',
				acsUrl: 'https://sp.example.com/acs',
				unknownField: true,
			})
			.expect(400);
	});

	it('API-SPC-21: PATCH deactivate SP', async () => {
		const sp = await createTestSpConnection(prisma, { active: true });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ active: false })
			.expect(200);
		expect(res.body.item.active).toBe(false);
	});

	it('API-SPC-22: PATCH null attributeMapping clears mapping', async () => {
		const sp = await createTestSpConnection(prisma, {
			attributeMapping: { attributes: [{ samlName: 'uid', source: 'username' }] },
		});
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ attributeMapping: null })
			.expect(200);
		expect(res.body.item.attributeMapping).toBeNull();
	});
});
