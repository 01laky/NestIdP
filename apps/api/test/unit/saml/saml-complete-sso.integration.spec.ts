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
import { AUTH_API_PATH, SAML_REQUEST_QUERY_PARAM, SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';
import { AuthModule } from '@api/auth/auth.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	buildTestAuthnRequestRedirectPayload,
	createTestApiConnection,
	createTestIdpSettingsWithSigningKey,
	createTestSamlSession,
	createTestSpConnection,
	createTestUserWithPassword,
	getTestSpEncryptionKeyPair,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { SamlModule } from '@api/saml/saml.module';
import { decryptEncryptedAssertion } from '@test/support/saml/decrypt-saml-assertion.util';
import {
	decodeSamlResponseBase64,
	extractSamlResponseFromHtml,
	verifySignedAssertionFragment,
} from '@test/support/saml/verify-saml-signature.util';

jest.setTimeout(90_000);

describe('SAML complete-sso integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	let spConnectionId: string;
	let spEntityId: string;
	let spAcsUrl: string;
	let connectionId: string;
	const password = 'sso-complete-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sso-complete-${randomUUID()}.db`);
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
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		const connection = await createTestApiConnection(prisma);
		connectionId = connection.id;
		await createTestUserWithPassword(prisma, connectionId, 'alice', password);
		const sp = await createTestSpConnection(prisma, {
			spEntityId: 'urn:test:sp:sso-complete',
			acsUrl: 'https://sp.example.com/acs',
		});
		spConnectionId = sp.id;
		spEntityId = sp.spEntityId;
		spAcsUrl = sp.acsUrl;
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	async function startSsoFlow(): Promise<{
		agent: request.Agent;
		samlSessionId: string;
		requestId: string;
	}> {
		const requestId = `_req-${Date.now()}`;
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
			id: requestId,
		});
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
			.send({ username: 'alice', password, samlSessionId })
			.expect(200);
		return { agent, samlSessionId, requestId };
	}

	it('API-AUTH-SSO-01: happy path returns HTML POST form to ACS', async () => {
		const { agent, samlSessionId } = await startSsoFlow();
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		expect(res.text).toContain(spAcsUrl);
		expect(extractSamlResponseFromHtml(res.text)).toBeTruthy();
	});

	it('API-AUTH-SSO-02: no session cookie → 401', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(401);
	});

	it('API-AUTH-SSO-03: session not bound → 400', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId);
		const agent = request.agent(app.getHttpServer() as App);
		await agent.post(`${AUTH_API_PATH}/login`).send({ username: 'alice', password }).expect(200);
		await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(400);
	});

	it('API-AUTH-SSO-04: expired session → 400', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
		});
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password, samlSessionId: session.id })
			.expect(400);
	});

	it('API-AUTH-SSO-05: unknown samlSessionId → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent.post(`${AUTH_API_PATH}/login`).send({ username: 'alice', password }).expect(200);
		await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx' })
			.expect(400);
	});

	it('API-AUTH-SSO-07: inactive user rejected on complete-sso', async () => {
		const { agent, samlSessionId } = await startSsoFlow();
		const alice = await prisma.user.findFirst({ where: { username: 'alice' } });
		await prisma.user.update({ where: { id: alice!.id }, data: { active: false } });
		try {
			await agent.post(`${AUTH_API_PATH}/login/complete-sso`).send({ samlSessionId }).expect(401);
		} finally {
			await prisma.user.update({ where: { id: alice!.id }, data: { active: true } });
		}
	});

	it('API-AUTH-SSO-06: wrong user vs bound session → 403', async () => {
		await createTestUserWithPassword(prisma, connectionId, 'bob', 'bob-pass-12345');
		const session = await createTestSamlSession(prisma, spConnectionId);
		const aliceAgent = request.agent(app.getHttpServer() as App);
		await aliceAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password, samlSessionId: session.id })
			.expect(200);
		const bobAgent = request.agent(app.getHttpServer() as App);
		await bobAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'bob', password: 'bob-pass-12345' })
			.expect(200);
		await bobAgent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(403);
	});

	it('API-AUTH-SSO-08: inactive SP rejected at login bind and complete-sso', async () => {
		const inactive = await createTestSpConnection(prisma, { active: false });
		const session = await createTestSamlSession(prisma, inactive.id);
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password, samlSessionId: session.id })
			.expect(400);
		const alice = await prisma.user.findFirst({ where: { username: 'alice' } });
		await prisma.samlSession.update({
			where: { id: session.id },
			data: { userId: alice!.id },
		});
		await agent.post(`${AUTH_API_PATH}/login`).send({ username: 'alice', password }).expect(200);
		await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: session.id })
			.expect(400);
	});

	it('API-AUTH-SSO-09: second complete on same session → 400', async () => {
		const { agent, samlSessionId } = await startSsoFlow();
		await agent.post(`${AUTH_API_PATH}/login/complete-sso`).send({ samlSessionId }).expect(200);
		await agent.post(`${AUTH_API_PATH}/login/complete-sso`).send({ samlSessionId }).expect(400);
	});

	it('API-AUTH-SSO-10: HTML contains base64 SAMLResponse not raw assertion', async () => {
		const { agent, samlSessionId } = await startSsoFlow();
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const b64 = extractSamlResponseFromHtml(res.text)!;
		expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
		const decoded = decodeSamlResponseBase64(b64);
		expect(decoded).toContain('saml2:Assertion');
		expect(res.text).not.toContain('<saml2:Assertion');
	});

	it('API-AUTH-SSO-11: RelayState echoed in form', async () => {
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: spEntityId,
			relayState: 'relay-xyz',
		});
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}&RelayState=relay-xyz`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get(SAML_SESSION_QUERY_PARAM)!;
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password, samlSessionId })
			.expect(200);
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		expect(res.text).toContain('value="relay-xyz"');
	});

	it('API-AUTH-SSO-12: auto-generates signing key when missing', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const { agent, samlSessionId } = await startSsoFlow();
		await agent.post(`${AUTH_API_PATH}/login/complete-sso`).send({ samlSessionId }).expect(200);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.signingCertPem).toBeTruthy();
	});

	it('API-AUTH-SSO-13: invalid cuid → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent.post(`${AUTH_API_PATH}/login`).send({ username: 'alice', password }).expect(200);
		await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId: 'not-a-cuid' })
			.expect(400);
	});

	it('API-AUTH-SSO-14: InResponseTo equals stored samlRequestId', async () => {
		const { agent, samlSessionId, requestId } = await startSsoFlow();
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(res.text)!);
		expect(xml).toContain(`InResponseTo="${requestId}"`);
	});

	it('API-AUTH-SSO-15: Content-Type is text/html', async () => {
		const { agent, samlSessionId } = await startSsoFlow();
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		expect(res.headers['content-type']).toMatch(/text\/html/);
	});

	it('API-IDP-SAML-ENC-02: complete-sso returns EncryptedAssertion when SP requests encryption', async () => {
		const spKeys = getTestSpEncryptionKeyPair('urn:test:sp:encrypted-complete');
		const encryptedSp = await createTestSpConnection(prisma, {
			spEntityId: 'urn:test:sp:encrypted-complete',
			acsUrl: 'https://sp-encrypted.example.com/acs',
			wantAssertionsEncrypted: true,
			spCertificate: spKeys.certPem,
		});
		const requestId = `_enc-req-${Date.now()}`;
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({
			issuer: encryptedSp.spEntityId,
			id: requestId,
		});
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
			.send({ username: 'alice', password, samlSessionId })
			.expect(200);
		const res = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(res.text)!);
		expect(xml).toContain('saml2:EncryptedAssertion');
		expect(xml).not.toMatch(/<saml2:Assertion[^>]/);
		const encryptedMatch = xml.match(/<saml2:EncryptedAssertion[\s\S]*<\/saml2:EncryptedAssertion>/);
		expect(encryptedMatch).toBeTruthy();
		const decrypted = decryptEncryptedAssertion(encryptedMatch![0], spKeys.privateKeyPem);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(verifySignedAssertionFragment(decrypted, settings!.signingCertPem!)).toBe(true);
		expect(decrypted).toContain(`InResponseTo="${requestId}"`);
	});
});
