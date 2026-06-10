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
import { generateTestRsaEncryptionCert } from '@test/support/crypto/test-cert.util';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { SamlModule } from '@api/saml/saml.module';
import { SpConnectionsModule } from '@api/sp-connections/sp-connections.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	buildTestAuthnRequestRedirectPayload,
	createTestAdminUserWithPassword,
	createTestIdpSettingsWithSigningKey,
	createTestSamlSession,
	createTestSpConnection,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

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

	it('API-SPC-23: list ordered by createdAt asc', async () => {
		const first = await createTestSpConnection(prisma, { name: 'Order First' });
		const second = await createTestSpConnection(prisma, { name: 'Order Second' });
		await prisma.spConnection.update({
			where: { id: first.id },
			data: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
		});
		await prisma.spConnection.update({
			where: { id: second.id },
			data: { createdAt: new Date('2021-01-01T00:00:00.000Z') },
		});
		const agent = await adminAgent();
		const res = await agent.get(SP_CONNECTIONS_API_PATH).expect(200);
		const ids = res.body.items.map((item: { id: string }) => item.id);
		expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
	});

	it('API-SPC-24: POST create with attributeMapping round-trip GET', async () => {
		const mapping = {
			nameId: { source: 'username' as const },
			attributes: [{ samlName: 'uid', source: 'username' as const }],
		};
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const created = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Mapped SP',
				spEntityId: 'urn:sp:mapped-create',
				acsUrl: 'https://sp.example.com/acs/mapped',
				attributeMapping: mapping,
			})
			.expect(201);
		const detail = await agent
			.get(`${SP_CONNECTIONS_API_PATH}/${created.body.item.id}`)
			.expect(200);
		expect(detail.body.attributeMapping).toEqual(mapping);
	});

	it('API-SPC-25: POST attributeMapping nameId override round-trip', async () => {
		const mapping = {
			nameId: {
				source: 'email' as const,
				format: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
			},
		};
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const created = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'NameID SP',
				spEntityId: 'urn:sp:nameid-override',
				acsUrl: 'https://sp.example.com/acs/nameid',
				attributeMapping: mapping,
			})
			.expect(201);
		expect(created.body.item.attributeMapping).toEqual(mapping);
	});

	it('API-SPC-26: PATCH deactivate then SSO redirect → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const created = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Deactivate SSO',
				spEntityId: 'urn:sp:deactivate-sso',
				acsUrl: 'https://sp.example.com/acs/deact',
			})
			.expect(201);
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${created.body.item.id}`)
			.set(csrfHeader(csrf))
			.send({ active: false })
			.expect(200);
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: 'urn:sp:deactivate-sso',
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(400);
	});

	it('API-SPC-27: POST http acsUrl allowed in test env', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'HTTP ACS',
				spEntityId: 'urn:sp:http-acs',
				acsUrl: 'http://sp.example.com/acs',
			})
			.expect(201);
		expect(res.body.item.acsUrl).toBe('http://sp.example.com/acs');
	});

	it('API-SPC-28: POST spCertificate PEM → hasSpCertificate true, GET omits PEM', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const created = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Cert SP',
				spEntityId: 'urn:sp:with-cert',
				acsUrl: 'https://sp.example.com/acs/cert',
				spCertificate: VALID_PEM,
			})
			.expect(201);
		expect(created.body.item.hasSpCertificate).toBe(true);
		expect(created.body.item.spCertificate).toBeUndefined();
		const detail = await agent
			.get(`${SP_CONNECTIONS_API_PATH}/${created.body.item.id}`)
			.expect(200);
		expect(detail.body.hasSpCertificate).toBe(true);
		expect(detail.body.spCertificate).toBeUndefined();
	});

	it('API-SPC-29: PATCH partial name only', async () => {
		const sp = await createTestSpConnection(prisma, { name: 'Old Name' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'Renamed SP' })
			.expect(200);
		expect(res.body.item.name).toBe('Renamed SP');
		expect(res.body.item.spEntityId).toBe(sp.spEntityId);
	});

	it('API-SPC-30: PATCH spEntityId conflict → 409', async () => {
		const existing = await createTestSpConnection(prisma, { spEntityId: 'urn:sp:taken-entity' });
		const target = await createTestSpConnection(prisma, { spEntityId: 'urn:sp:other-entity' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${target.id}`)
			.set(csrfHeader(csrf))
			.send({ spEntityId: existing.spEntityId })
			.expect(409);
	});

	it('API-SPC-31: DELETE unknown id → 404', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.delete(`${SP_CONNECTIONS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`)
			.set(csrfHeader(csrf))
			.expect(404);
	});

	it('API-SPC-32: PATCH without admin session → 401', async () => {
		const sp = await createTestSpConnection(prisma);
		await request(app.getHttpServer() as App)
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.send({ name: 'No Session' })
			.expect(401);
	});

	it('API-SPC-33: create with active:false', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Inactive SP',
				spEntityId: 'urn:sp:inactive-create',
				acsUrl: 'https://sp.example.com/acs/inactive',
				active: false,
			})
			.expect(201);
		expect(res.body.item.active).toBe(false);
	});

	it('API-SPC-34: name trim applied on create', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: '  Trimmed Name  ',
				spEntityId: 'urn:sp:trim-name',
				acsUrl: 'https://sp.example.com/acs/trim',
			})
			.expect(201);
		expect(res.body.item.name).toBe('Trimmed Name');
	});

	it('API-SPC-35: acsUrl trailing slash normalized on create', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Slash ACS',
				spEntityId: 'urn:sp:slash-acs',
				acsUrl: 'https://sp.example.com/acs/',
			})
			.expect(201);
		expect(res.body.item.acsUrl).toBe('https://sp.example.com/acs');
	});

	it('API-SPC-36: default nameIdFormat applied on create', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Default Format',
				spEntityId: 'urn:sp:default-format',
				acsUrl: 'https://sp.example.com/acs/format',
			})
			.expect(201);
		expect(res.body.item.nameIdFormat).toBe(
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		);
	});

	it('API-SPC-37: DELETE cascades SamlSession rows', async () => {
		const sp = await createTestSpConnection(prisma, { active: false });
		const session = await createTestSamlSession(prisma, sp.id);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent.delete(`${SP_CONNECTIONS_API_PATH}/${sp.id}`).set(csrfHeader(csrf)).expect(200);
		const gone = await prisma.samlSession.findUnique({ where: { id: session.id } });
		expect(gone).toBeNull();
	});

	it('API-SPC-38: test-acs without CSRF → 403', async () => {
		const sp = await createTestSpConnection(prisma);
		const agent = await adminAgent();
		await agent.post(`${SP_CONNECTIONS_API_PATH}/${sp.id}/test-acs`).expect(403);
	});

	it('API-SPC-39: deactivated SP still listed with active badge field', async () => {
		const sp = await createTestSpConnection(prisma, { active: false, name: 'Inactive Listed' });
		const agent = await adminAgent();
		const res = await agent.get(SP_CONNECTIONS_API_PATH).expect(200);
		const item = res.body.items.find((row: { id: string }) => row.id === sp.id);
		expect(item?.active).toBe(false);
	});

	it('API-SP-ENC-01: new SP defaults wantAssertionsEncrypted false', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Plain Assertions',
				spEntityId: 'urn:sp:plain-assertions',
				acsUrl: 'https://sp.example.com/acs/plain',
			})
			.expect(201);
		expect(res.body.item.wantAssertionsEncrypted).toBe(false);
	});

	it('API-SP-ENC-02: wantAssertionsEncrypted true without SP certificate → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Encrypted Required',
				spEntityId: 'urn:sp:enc-required',
				acsUrl: 'https://sp.example.com/acs/enc',
				wantAssertionsEncrypted: true,
			})
			.expect(400);
	});

	it('API-SP-ENC-03: wantAssertionsEncrypted true with SP certificate PEM → 201', async () => {
		const { certPem } = generateTestRsaEncryptionCert('https://idp.example.com');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Encrypted OK',
				spEntityId: 'urn:sp:enc-ok',
				acsUrl: 'https://sp.example.com/acs/enc-ok',
				spCertificate: certPem,
				wantAssertionsEncrypted: true,
			})
			.expect(201);
		expect(res.body.item.wantAssertionsEncrypted).toBe(true);
	});

	it('API-SP-ENC-04: PATCH enable encrypted assertions without SP cert → 400', async () => {
		const sp = await createTestSpConnection(prisma, { name: 'Enc Patch Target' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ wantAssertionsEncrypted: true })
			.expect(400);
	});
});
