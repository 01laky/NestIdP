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
	AUTH_API_PATH,
	IDP_SETTINGS_API_PATH,
	SAML_REQUEST_QUERY_PARAM,
} from '@nestidp/shared';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
	buildTestAuthnRequestRedirectPayload,
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestIdpSettingsWithEncryptionKey,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	createTestUserWithPassword,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { SamlModule } from '../saml/saml.module';
import { IdpSettingsModule } from './idp-settings.module';
import { IdpSigningService } from '../saml/idp-signing.service';
import {
	decodeSamlResponseBase64,
	extractSamlResponseFromHtml,
	verifySamlXmlSignature,
} from '../saml/testing/verify-saml-signature.util';
import { fingerprintSha256Hex } from './idp-cert.util';

jest.setTimeout(90_000);

describe('IdP settings SAML metadata & rotation (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let idpSigning: IdpSigningService;
	let databaseUrl: string;
	let spEntityId: string;
	const adminPassword = 'idp-saml-admin-pass';
	const endUserPassword = 'idp-saml-user-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-idp-saml-${randomUUID()}.db`);
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
				IdpSettingsModule,
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
		idpSigning = app.get(IdpSigningService);
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
		const connection = await createTestApiConnection(prisma);
		await createTestUserWithPassword(prisma, connection.id, 'alice', endUserPassword);
		const sp = await createTestSpConnection(prisma, {
			spEntityId: 'urn:test:sp:idp-saml',
			acsUrl: 'https://sp.example.com/acs',
		});
		spEntityId = sp.spEntityId;
	});

	afterEach(async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}

	async function adminCsrfAgent(): Promise<{ agent: request.Agent; csrf: string }> {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return { agent, csrf: login.body.csrfToken as string };
	}

	function countKeyDescriptors(xml: string): number {
		return (xml.match(/<md:KeyDescriptor/g) ?? []).length;
	}

	it('API-IDP-SAML-01: public metadata has single signing cert without rotation', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(countKeyDescriptors(res.text)).toBe(1);
	});

	it('API-IDP-SAML-02: public metadata lists primary and pending during rotation', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(countKeyDescriptors(res.text)).toBe(2);
	});

	it('API-IDP-SAML-03: metadata entityID matches configured entityId', async () => {
		const entityId = 'https://entity-in-metadata.example.com';
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { entityId },
		});
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).toContain(`entityID="${entityId}"`);
	});

	it('API-IDP-SAML-04: complete rotation leaves single cert in metadata', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(countKeyDescriptors(res.text)).toBe(1);
	});

	it('API-IDP-SAML-05: cancel rotation removes pending cert from metadata', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const withPending = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(countKeyDescriptors(withPending.text)).toBe(2);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
		const afterCancel = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(countKeyDescriptors(afterCancel.text)).toBe(1);
	});

	it('API-IDP-SAML-06: metadata includes configured nameIdFormat', async () => {
		const format = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
		await prisma.idpSettings.update({ where: { id: 'default' }, data: { nameIdFormat: format } });
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).toContain(format);
	});

	it('API-IDP-SAML-07: getMetadataSigningCertificates returns primary then pending', async () => {
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const updated = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const certs = await idpSigning.getMetadataSigningCertificates();
		expect(certs).toHaveLength(2);
		expect(certs[0]).toBe(settings!.signingCertPem);
		expect(certs[1]).toBe(updated!.pendingSigningCertPem);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-SAML-08: SSO assertions signed with primary cert during rotation', async () => {
		const { agent: adminAgentRot, csrf: rotCsrf } = await adminCsrfAgent();
		await adminAgentRot
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(rotCsrf))
			.send({ mode: 'generate' })
			.expect(201);
		const settingsBefore = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const primaryFp = fingerprintSha256Hex(settingsBefore!.signingCertPem!);
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get('samlSessionId')!;
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId })
			.expect(200);
		const complete = await agent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(verifySamlXmlSignature(xml, settingsBefore!.signingCertPem!)).toBe(true);
		expect(fingerprintSha256Hex(settingsBefore!.signingCertPem!)).toBe(primaryFp);
	});

	it('API-IDP-SAML-09: admin metadata-preview matches public metadata entity', async () => {
		const { agent } = await adminCsrfAgent();
		const preview = await agent.get(`${IDP_SETTINGS_API_PATH}/metadata-preview`).expect(200);
		const publicMeta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(preview.body.xml).toContain('entityID=');
		expect(publicMeta.text).toContain(preview.body.xml.match(/entityID="[^"]+"/)?.[0] ?? '');
	});

	it('API-IDP-SAML-10: upload rotation adds distinct pending fingerprint', async () => {
		const { certPem, privateKeyPem } = idpSigning.generateKeyPairAndCert(
			'https://pending-rotation.example.com',
		);
		const { agent, csrf } = await adminCsrfAgent();
		const before = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'upload', signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(201);
		const after = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(after.body.rotation.pendingCertFingerprintSha256).not.toBe(
			before.body.signingCertFingerprintSha256,
		);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-SAML-11: metadata never embeds private key material', async () => {
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).not.toContain('BEGIN PRIVATE KEY');
		expect(res.text).not.toContain('BEGIN RSA PRIVATE KEY');
	});

	it('API-IDP-SAML-12: metadata includes default unspecified NameIDFormat', async () => {
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).toContain('nameid-format:unspecified');
	});

	it('API-IDP-SAML-13: complete rotation updates metadata signing cert fingerprint', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const pendingFp = (await agent.get(IDP_SETTINGS_API_PATH).expect(200)).body.rotation
			.pendingCertFingerprintSha256;
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		const settings = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(settings.body.signingCertFingerprintSha256).toBe(pendingFp);
		const meta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(meta.text).toContain('X509Certificate');
	});

	it('API-IDP-SAML-14: ensureSigningMaterial throws when only pending cert configured', async () => {
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: null,
				signingKeyEncrypted: null,
				pendingSigningCertPem: settings!.pendingSigningCertPem ?? settings!.signingCertPem,
				pendingSigningKeyEncrypted:
					settings!.pendingSigningKeyEncrypted ?? settings!.signingKeyEncrypted,
			},
		});
		await expect(idpSigning.ensureSigningMaterial()).rejects.toThrow(
			'signing certificate not configured',
		);
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
	});

	it('API-IDP-SAML-15: metadata SSO Location uses IDP_BASE_URL', async () => {
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).toContain('http://localhost:3000/saml/sso');
	});

	it('API-IDP-SAML-16: pending cert body appears in metadata X509Certificate nodes', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const pendingBody = idpSigning.extractX509CertificatePem(settings!.pendingSigningCertPem!);
		const meta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(meta.text).toContain(pendingBody);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-SAML-17: lazy auto-generate when primary cert missing and no rotation', async () => {
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
		const res = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(res.text).toContain('X509Certificate');
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(row?.signingCertPem).toContain('BEGIN CERTIFICATE');
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
	});

	it('API-IDP-SAML-18: SSO happy path still passes after entityId PATCH', async () => {
		const newEntityId = 'https://sso-after-entity-id.example.com';
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: newEntityId })
			.expect(200);
		const meta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(meta.text).toContain(`entityID="${newEntityId}"`);
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get('samlSessionId')!;
		const userAgent = request.agent(app.getHttpServer() as App);
		await userAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId })
			.expect(200);
		const complete = await userAgent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(verifySamlXmlSignature(xml, settings!.signingCertPem!)).toBe(true);
	});

	it('API-IDP-SAML-19: after complete rotation assertions verify with promoted cert only', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const pendingFp = (await agent.get(IDP_SETTINGS_API_PATH).expect(200)).body.rotation
			.pendingCertFingerprintSha256;
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(fingerprintSha256Hex(settings!.signingCertPem!)).toBe(pendingFp);
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get('samlSessionId')!;
		const userAgent = request.agent(app.getHttpServer() as App);
		await userAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId })
			.expect(200);
		const complete = await userAgent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(verifySamlXmlSignature(xml, settings!.signingCertPem!)).toBe(true);
	});

	it('API-IDP-SAML-ENC-01: SSO still signs assertions when encryption cert is configured', async () => {
		await createTestIdpSettingsWithEncryptionKey(prisma);
		const { samlRequest } = buildTestAuthnRequestRedirectPayload({ issuer: spEntityId });
		const redirect = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${SAML_REQUEST_QUERY_PARAM}=${samlRequest}`)
			.expect(302);
		const samlSessionId = new URL(
			redirect.headers.location as string,
			'http://localhost',
		).searchParams.get('samlSessionId')!;
		const userAgent = request.agent(app.getHttpServer() as App);
		await userAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'alice', password: endUserPassword, samlSessionId })
			.expect(200);
		const complete = await userAgent
			.post(`${AUTH_API_PATH}/login/complete-sso`)
			.send({ samlSessionId })
			.expect(200);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const xml = decodeSamlResponseBase64(extractSamlResponseFromHtml(complete.text)!);
		expect(verifySamlXmlSignature(xml, settings!.signingCertPem!)).toBe(true);
		expect(settings?.encryptionCertPem).toContain('BEGIN CERTIFICATE');
	});

	it('API-SAML-META-ENC-03: metadata lists two encryption KeyDescriptors during encryption rotation', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await createTestIdpSettingsWithEncryptionKey(prisma);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', rsaModulusBits: 3072 })
			.expect(201);
		const meta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect((meta.text.match(/use="encryption"/g) ?? []).length).toBe(2);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});
});
