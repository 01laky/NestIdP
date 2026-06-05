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
	AUTH_API_PATH,
	LOGIN_PAGE_ROUTE,
	SAML_REQUEST_QUERY_PARAM,
	SAML_SESSION_QUERY_PARAM,
} from '@nestidp/shared';
import { AuthModule } from '@api/auth/auth.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	buildTestAuthnRequestRedirectPayload,
	createTestApiConnection,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	createTestUserWithPassword,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { SamlModule } from '@api/saml/saml.module';
import {
	decodeSamlResponseBase64,
	extractSamlResponseFromHtml,
	verifySamlXmlSignature,
} from '@test/support/saml/verify-saml-signature.util';

jest.setTimeout(90_000);

describe('SAML integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	let spEntityId: string;
	let spAcsUrl: string;
	const endUserPassword = 'saml-integration-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-saml-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');

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
				SamlModule,
				AuthModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();

		prisma = app.get(PrismaService);
		await createTestIdpSettingsWithSigningKey(prisma, {
			entityId: 'http://localhost:3000',
		});
		const connection = await createTestApiConnection(prisma);
		await createTestUserWithPassword(prisma, connection.id, 'alice', endUserPassword);
		const sp = await createTestSpConnection(prisma, {
			spEntityId: 'urn:test:sp:integration',
			acsUrl: 'https://sp.example.com/acs',
		});
		spEntityId = sp.spEntityId;
		spAcsUrl = sp.acsUrl;
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

	async function loginWithSamlSession(agent: request.Agent, samlSessionId: string): Promise<void> {
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId })
			.expect(200);
	}

	it('API-SAML-INT-01: full SSO redirect → login → bind → complete-sso HTML', async () => {
		const { samlRequest, relayState } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
		});

		const redirect = await request(app.getHttpServer() as App)
			.get(
				`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}&RelayState=${encodeURIComponent(relayState ?? 'state-1')}`,
			)
			.expect(302);

		const location = redirect.headers.location as string;
		expect(location).toContain(LOGIN_PAGE_ROUTE);
		expect(location).toContain(SAML_SESSION_QUERY_PARAM);

		const samlSessionId = new URL(location, 'http://localhost').searchParams.get(
			SAML_SESSION_QUERY_PARAM,
		);
		expect(samlSessionId).toBeTruthy();

		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId!);

		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);

		expect(complete.headers['content-type']).toMatch(/text\/html/);
		expect(complete.text).toContain(spAcsUrl);
		const b64 = extractSamlResponseFromHtml(complete.text);
		expect(b64).toBeTruthy();
		const xml = decodeSamlResponseBase64(b64!);
		expect(xml).toContain('InResponseTo');

		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(verifySamlXmlSignature(xml, settings!.signingCertPem!)).toBe(true);
	});

	it('API-SAML-INT-02: metadata contains cert after auto-generate', async () => {
		const response = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(response.headers['content-type']).toMatch(/xml/);
		expect(response.text).toContain('EntityDescriptor');
		expect(response.text).toContain('X509Certificate');
	});

	it('API-SAML-INT-03: unknown issuer → 400', async () => {
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: 'urn:unknown:sp',
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(400);
	});

	it('API-SAML-INT-10: complete without login → 401', async () => {
		const session = await prisma.samlSession.create({
			data: {
				samlRequestId: `_req-${Date.now()}`,
				spConnectionId: (await prisma.spConnection.findFirst())!.id,
				expiresAt: new Date(Date.now() + 60_000),
			},
		});
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(401);
	});

	it('API-SAML-INT-04: expired session before complete → 400', async () => {
		const session = await prisma.samlSession.create({
			data: {
				samlRequestId: `_exp-${Date.now()}`,
				spConnectionId: (await prisma.spConnection.findFirst())!.id,
				expiresAt: new Date(Date.now() - 1000),
				userId: (await prisma.user.findFirst({ where: { username: 'alice' } }))!.id,
			},
		});
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
		await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(400);
	});

	it('API-SAML-INT-05: login without samlSessionId still works', async () => {
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword })
			.expect(200);
	});

	it('API-SAML-INT-06: GET /saml/metadata never returns SPA HTML', async () => {
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).not.toContain('<!DOCTYPE html>');
		expect(res.text).toContain('EntityDescriptor');
	});

	it('API-SAML-INT-07: duplicate AuthnRequest ID → 409', async () => {
		const requestId = `_dup-${Date.now()}`;
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
			id: requestId,
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(409);
	});

	it('API-SAML-INT-08: custom attribute mapping on SP row', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:sp:map-${Date.now()}`,
			attributeMapping: { attributes: [{ samlName: 'login', source: 'username' }] },
		});
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: sp.spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId);
		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(xml).toContain('login');
	});

	it('API-SAML-INT-09: NameID username when user email null', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestUserWithPassword(prisma, connection.id, 'noemail', endUserPassword, {
			email: null,
		});
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:sp:noemail-${Date.now()}`,
		});
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: sp.spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'noemail', password: endUserPassword, samlSessionId })
			.expect(200);
		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(xml).toContain('>noemail<');
	});

	it('API-SAML-INT-12: acsUrl in form action matches SpConnection', async () => {
		const acs = 'https://custom.acs.example/saml/consume';
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:sp:acs-${Date.now()}`,
			acsUrl: acs,
		});
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: sp.spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId);
		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		expect(complete.text).toContain(`action="${acs}"`);
	});

	it('API-SAML-INT-13: signature verify on issued response', async () => {
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId);
		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(verifySamlXmlSignature(xml, settings!.signingCertPem!)).toBe(true);
		const tampered = xml.replace(
			/(<saml2:NameID[^>]*>)([^<]+)(<\/saml2:NameID>)/,
			'$1$2-tampered$3',
		);
		expect(tampered).not.toBe(xml);
		expect(verifySamlXmlSignature(tampered, settings!.signingCertPem!)).toBe(false);
	});

	it('API-SAML-INT-14: readyToComplete true when bound and authenticated', async () => {
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId);
		const status = await agent
			.get(`${AUTH_API_PATH}/session?samlSessionId=${samlSessionId}`)
			.expect(200);
		expect(status.body.samlSession?.readyToComplete).toBe(true);
	});

	it('API-SAML-INT-15: inactive SP rejected at SSO redirect', async () => {
		const inactive = await createTestSpConnection(prisma, { active: false });
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: inactive.spEntityId });
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(400);
	});

	it('API-SAML-INT-16: two concurrent AuthnRequests yield distinct sessions', async () => {
		const { samlRequest: r1 } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
			id: `_c1-${Date.now()}`,
		});
		const { samlRequest: r2 } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
			id: `_c2-${Date.now()}`,
		});
		const loc1 = (
			await request(app.getHttpServer() as App)
				.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${r1}`)
				.expect(302)
		).headers.location as string;
		const loc2 = (
			await request(app.getHttpServer() as App)
				.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${r2}`)
				.expect(302)
		).headers.location as string;
		const id1 = new URL(loc1, 'http://localhost').searchParams.get(SAML_SESSION_QUERY_PARAM);
		const id2 = new URL(loc2, 'http://localhost').searchParams.get(SAML_SESSION_QUERY_PARAM);
		expect(id1).toBeTruthy();
		expect(id2).toBeTruthy();
		expect(id1).not.toBe(id2);
	});

	it('API-SAML-INT-11: session deleted after successful complete-sso', async () => {
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await loginWithSamlSession(agent, samlSessionId);
		await agent.post(`${AUTH_API_PATH}/login/complete-sso`).send({ samlSessionId }).expect(200);
		expect(await prisma.samlSession.findUnique({ where: { id: samlSessionId } })).toBeNull();
	});
});
