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
	IDP_METADATA_URL_API_PATH,
	IDP_SETTINGS_API_PATH,
	IDP_SIGNING_SIGNATURE_ALGORITHMS,
} from '@nestidp/shared';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { AdminModule } from '@api/admin/admin.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { SamlModule } from '@api/saml/saml.module';
import { SpConnectionsModule } from '@api/sp-connections/sp-connections.module';
import { IdpSettingsModule } from '@api/idp-settings/idp-settings.module';
import { IdpSigningService } from '@api/saml/services/idp-signing.service';
import { fingerprintSha256Hex, parseCertNotAfterIso } from '@api/idp-settings/utils/idp-cert.util';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestIdpSettings,
	createTestIdpSettingsWithEncryptionKey,
	createTestIdpSettingsWithSigningKey,
	getTestSigningMaterial,
} from '@test/support/prisma/test-fixtures';
import { generateTestRsaEncryptionCert } from '@api/idp-settings/utils/idp-encryption-cert.util';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(60_000);

async function waitForEncryptionCertGeneratedAudit(
	prisma: PrismaService,
	predicate: (metadata: unknown) => boolean,
) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const row = await prisma.auditEvent.findFirst({
			where: { event: 'idp_encryption_cert_generated' },
			orderBy: { createdAt: 'desc' },
		});
		if (row && predicate(row.metadata)) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return null;
}

describe('IdP settings admin API (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'idp-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-idp-admin-${randomUUID()}.db`);
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
				SpConnectionsModule,
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

	afterEach(async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				pendingSigningKeyFamily: null,
				pendingSigningSignatureAlgorithmId: null,
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: null,
				rotationStartedAt: null,
				pendingEncryptionCertPem: null,
				pendingEncryptionKeyEncrypted: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				encryptionRotationStartedAt: null,
				encryptionCertPem: null,
				encryptionKeyEncrypted: null,
				encryptionKeyFamily: null,
				encryptionKeyTransportAlgorithmId: null,
				encryptionRsaModulusBits: null,
				encryptionEcCurve: null,
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

	it('API-IDP-ADM-01: GET without admin session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(IDP_SETTINGS_API_PATH)
			.expect(401);
	});

	it('API-IDP-ADM-02: GET returns settings with URLs and cert summary', async () => {
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.entityId).toBeTruthy();
		expect(res.body.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(res.body.ssoUrl).toBe('http://localhost:3000/saml/sso');
		expect(res.body.hasSigningCertificate).toBe(true);
		expect(res.body.signingCertFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('API-IDP-ADM-03: GET never exposes private key or encrypted blob', async () => {
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.signingPrivateKeyPem).toBeUndefined();
		expect(res.body.signingKeyEncrypted).toBeUndefined();
		expect(JSON.stringify(res.body)).not.toContain('BEGIN PRIVATE KEY');
	});

	it('API-IDP-ADM-04: GET returns JSON not HTML', async () => {
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH);
		expect(res.headers['content-type']).toMatch(/application\/json/);
		expect(res.text).not.toContain('<!DOCTYPE html>');
	});

	it('API-IDP-ADM-05: rotation block inactive by default', async () => {
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.rotation.active).toBe(false);
		expect(res.body.rotation.hasPendingCertificate).toBe(false);
	});

	it('API-IDP-ADM-06: PATCH without CSRF → 403', async () => {
		const agent = await adminAgent();
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.send({ entityId: 'https://idp-patched.example.com' })
			.expect(403);
	});

	it('API-IDP-ADM-07: PATCH updates entityId', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: 'https://idp-updated.example.com' })
			.expect(200);
		expect(res.body.entityId).toBe('https://idp-updated.example.com');
	});

	it('API-IDP-ADM-08: PATCH updates nameIdFormat', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const format = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
		const res = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ nameIdFormat: format })
			.expect(200);
		expect(res.body.nameIdFormat).toBe(format);
	});

	it('API-IDP-REQ-SIG-01: PATCH wantAuthnRequestsSigned updates IdP settings and metadata flag', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const updated = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ wantAuthnRequestsSigned: true })
			.expect(200);
		expect(updated.body.wantAuthnRequestsSigned).toBe(true);

		const metadata = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		expect(metadata.text).toContain('wantAuthnRequestsSigned="true"');
	});

	it('API-IDP-ADM-09: PATCH empty body → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent.patch(IDP_SETTINGS_API_PATH).set(csrfHeader(csrf)).send({}).expect(400);
	});

	it('API-IDP-ADM-10: PATCH invalid entityId → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: 'not-valid' })
			.expect(400);
	});

	it('API-IDP-ADM-11: PATCH invalid nameIdFormat → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ nameIdFormat: 'bad-format' })
			.expect(400);
	});

	it('API-IDP-ADM-12: PATCH without admin session → 401', async () => {
		await request(app.getHttpServer() as App)
			.patch(IDP_SETTINGS_API_PATH)
			.send({ entityId: 'https://no-session.example.com' })
			.expect(401);
	});

	it('API-IDP-ADM-13: POST generate signing cert without CSRF → 403', async () => {
		const agent = await adminAgent();
		await agent.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`).expect(403);
	});

	it('API-IDP-ADM-14: POST generate signing cert replaces primary', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const before = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.expect(201);
		expect(res.body.hasSigningCertificate).toBe(true);
		expect(res.body.signingCertFingerprintSha256).not.toBe(
			before.body.signingCertFingerprintSha256,
		);
	});

	it('API-IDP-ADM-15: POST generate blocked during active rotation → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.expect(409);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-16: POST upload signing cert with valid pair', async () => {
		const idpSigning = app.get(IdpSigningService);
		const { certPem, privateKeyPem } = idpSigning.generateKeyPairAndCert(
			'https://upload-idp.example.com',
		);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(201);
		expect(res.body.hasSigningCertificate).toBe(true);
	});

	it('API-IDP-ADM-17: POST upload mismatched cert and key → 400', async () => {
		const primary = getTestSigningMaterial('https://primary.example.com');
		const other = getTestSigningMaterial('https://other.example.com');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.set(csrfHeader(csrf))
			.send({
				signingCertPem: primary.certPem,
				signingPrivateKeyPem: other.privateKeyPem,
			})
			.expect(400);
	});

	it('API-IDP-ADM-18: POST upload invalid PEM → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ signingCertPem: 'not-pem', signingPrivateKeyPem: 'not-pem' })
			.expect(400);
	});

	it('API-IDP-ADM-19: POST upload without CSRF → 403', async () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial('https://csrf-upload.example.com');
		const agent = await adminAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.send({ signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(403);
	});

	it('API-IDP-ADM-20: POST rotation start generate mode', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		expect(res.body.rotation.active).toBe(true);
		expect(res.body.rotation.hasPendingCertificate).toBe(true);
		expect(res.body.rotation.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('API-IDP-ADM-21: POST rotation start upload mode', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
		const idpSigning = app.get(IdpSigningService);
		const { certPem, privateKeyPem } = idpSigning.generateKeyPairAndCert(
			'https://rotation-upload.example.com',
		);
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'upload', signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(201);
		expect(res.body.rotation.active).toBe(true);
		expect(res.body.rotation.pendingCertFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('API-IDP-ADM-22: POST rotation start without primary cert → 409', async () => {
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
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(409);
		await createTestIdpSettingsWithSigningKey(prisma, {
			entityId: 'https://idp-updated.example.com',
		});
	});

	it('API-IDP-ADM-23: POST rotation start when already active → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(409);
	});

	it('API-IDP-ADM-24: POST rotation complete promotes pending cert', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const pendingFp = (await agent.get(IDP_SETTINGS_API_PATH).expect(200)).body.rotation
			.pendingCertFingerprintSha256;
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		expect(res.body.rotation.active).toBe(false);
		expect(res.body.signingCertFingerprintSha256).toBe(pendingFp);
	});

	it('API-IDP-ADM-25: POST rotation complete when none active → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-IDP-ADM-26: POST rotation cancel clears pending', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
		expect(res.body.rotation.active).toBe(false);
		expect(res.body.rotation.hasPendingCertificate).toBe(false);
	});

	it('API-IDP-ADM-27: POST rotation cancel when none active → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(409);
	});

	it('API-IDP-ADM-28: GET metadata-preview returns SAML XML', async () => {
		const agent = await adminAgent();
		const res = await agent.get(`${IDP_SETTINGS_API_PATH}/metadata-preview`).expect(200);
		expect(res.body.contentType).toBe('application/samlmetadata+xml');
		expect(res.body.xml).toContain('EntityDescriptor');
		expect(res.body.xml).toContain('X509Certificate');
		expect(res.body.xml).not.toContain('BEGIN PRIVATE KEY');
	});

	it('API-IDP-ADM-29: PATCH forbidNonWhitelisted field → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: 'https://ok.example.com', unknownField: true })
			.expect(400);
	});

	it('API-IDP-ADM-30: entityId trim applied on PATCH', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: '  https://trimmed-idp.example.com  ' })
			.expect(200);
		expect(res.body.entityId).toBe('https://trimmed-idp.example.com');
	});

	it('API-IDP-ADM-31: POST rotation start without CSRF → 403', async () => {
		const agent = await adminAgent();
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.send({ mode: 'generate' })
			.expect(403);
	});

	it('API-IDP-ADM-32: GET when settings row missing → 404', async () => {
		await prisma.idpSettings.delete({ where: { id: 'default' } });
		const agent = await adminAgent();
		await agent.get(IDP_SETTINGS_API_PATH).expect(404);
		await createTestIdpSettings(prisma, { entityId: 'https://restored-idp.example.com' });
		await createTestIdpSettingsWithSigningKey(prisma, {
			entityId: 'https://restored-idp.example.com',
		});
	});

	it('API-IDP-ADM-33: settings without cert report hasSigningCertificate false', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.hasSigningCertificate).toBe(false);
		expect(res.body.signingCertFingerprintSha256).toBeNull();
		await createTestIdpSettingsWithSigningKey(prisma, {
			entityId: 'https://restored-idp.example.com',
		});
	});

	it('API-IDP-ADM-34: updatedAt changes after PATCH', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const before = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		const res = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified' })
			.expect(200);
		expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
			new Date(before.body.updatedAt).getTime(),
		);
	});

	it('API-IDP-ADM-35: metadata-url helper returns updated entityId after PATCH', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const newEntityId = 'https://metadata-url-updated.example.com';
		await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: newEntityId })
			.expect(200);
		const meta = await agent.get(IDP_METADATA_URL_API_PATH).expect(200);
		expect(meta.body.entityId).toBe(newEntityId);
	});

	it('API-IDP-ADM-36: metadata preview matches public metadata entity block', async () => {
		const agent = await adminAgent();
		const preview = await agent.get(`${IDP_SETTINGS_API_PATH}/metadata-preview`).expect(200);
		const publicMeta = await request(app.getHttpServer() as App)
			.get('/saml/metadata')
			.expect(200);
		const normalize = (xml: string) => xml.replace(/\s+/g, '');
		expect(normalize(preview.body.xml)).toBe(normalize(publicMeta.text));
	});

	it('API-IDP-ADM-37: POST upload primary during active rotation → 409', async () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial('https://upload-blocked.example.com');
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(409);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-38: POST rotation complete without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const agentNoCsrf = await adminAgent();
		await agentNoCsrf.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`).expect(403);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-39: GET metadata-preview without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${IDP_SETTINGS_API_PATH}/metadata-preview`)
			.expect(401);
	});

	it('API-IDP-ADM-40: fingerprint in DTO matches actual primary cert', async () => {
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.signingCertFingerprintSha256).toBe(fingerprintSha256Hex(row!.signingCertPem!));
	});

	it('API-IDP-ADM-41: GET never returns signingCertPem or pending PEM fields', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(res.body.signingCertPem).toBeUndefined();
		expect(res.body.pendingSigningCertPem).toBeUndefined();
		expect(JSON.stringify(res.body)).not.toContain('BEGIN CERTIFICATE');
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-42: two sequential rotation starts blocked until complete', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(409);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-43: primary fingerprint stable across consecutive GETs', async () => {
		const agent = await adminAgent();
		const first = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		const second = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(second.body.signingCertFingerprintSha256).toBe(first.body.signingCertFingerprintSha256);
	});

	it('API-IDP-ADM-44: PATCH entityId and nameIdFormat together', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const format = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';
		const res = await agent
			.patch(IDP_SETTINGS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ entityId: 'https://dual-patch.example.com', nameIdFormat: format })
			.expect(200);
		expect(res.body.entityId).toBe('https://dual-patch.example.com');
		expect(res.body.nameIdFormat).toBe(format);
	});

	it('API-IDP-ADM-45: POST generate without admin session → 401', async () => {
		await request(app.getHttpServer() as App)
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.expect(401);
	});

	it('API-IDP-ADM-46: pending fingerprint differs from primary during rotation', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const before = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
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

	it('API-IDP-ADM-47: GET /api/admin dashboard still works alongside settings API', async () => {
		const agent = await adminAgent();
		const dash = await agent.get('/api/admin').expect(200);
		const settings = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(dash.body.idp).toBeDefined();
		expect(settings.body.entityId).toBeTruthy();
	});

	it('API-IDP-ADM-48: POST rotation cancel without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const agentNoCsrf = await adminAgent();
		await agentNoCsrf.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`).expect(403);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ADM-49: rotation start upload mode missing PEM fields → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'upload' })
			.expect(400);
	});

	it('API-IDP-ADM-50: complete rotation clears rotationStartedAt in DTO', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		expect(res.body.rotation.active).toBe(false);
		expect(res.body.rotation.startedAt).toBeNull();
	});

	it('API-IDP-CRYPTO-01: generate with RSA options sets crypto columns', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: null,
				signingKeyEncrypted: null,
				signingKeyFamily: null,
				signingSignatureAlgorithmId: null,
				signingRsaModulusBits: null,
			},
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				keyFamily: 'rsa',
				rsaModulusBits: 2048,
				signatureAlgorithmId: 'rsa-sha256',
				notAfter: '2028-12-31',
			})
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('rsa');
		expect(res.body.signingSignatureAlgorithmId).toBe('rsa-sha256');
		expect(res.body.signingRsaModulusBits).toBe(2048);
	});

	it('API-IDP-CRYPTO-05: notAfter in the past → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '1999-01-01' })
			.expect(400);
	});

	it('API-IDP-CRYPTO-08: rotation generate stores pending crypto in DTO', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({
				mode: 'generate',
				rsaModulusBits: 3072,
				signatureAlgorithmId: 'rsa-sha384',
				notAfter: '2029-06-01',
			})
			.expect(201);
		expect(res.body.rotation.pendingSigningKeyFamily).toBe('rsa');
		expect(res.body.rotation.pendingSigningSignatureAlgorithmId).toBe('rsa-sha384');
		expect(res.body.rotation.pendingSigningRsaModulusBits).toBe(3072);
		expect(res.body.rotation.pendingSigningCertNotAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('API-IDP-ADM-REG-01: POST generate with empty body still succeeds (backward compatible)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(201);
		expect(res.body.signingSignatureAlgorithmId).toBe('rsa-sha256');
	});

	it('API-IDP-CRYPTO-02: generate EC P-256 + ecdsa-sha256', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				keyFamily: 'ec',
				ecCurve: 'P-256',
				signatureAlgorithmId: 'ecdsa-sha256',
				notAfter: '2029-06-01',
			})
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('ec');
		expect(res.body.signingEcCurve).toBe('P-256');
		expect(res.body.signingSignatureAlgorithmId).toBe('ecdsa-sha256');
	});

	it('API-IDP-CRYPTO-03: each signature id with matching key family succeeds', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		for (const algo of IDP_SIGNING_SIGNATURE_ALGORITHMS) {
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
			const body =
				algo.keyFamily === 'rsa'
					? {
							keyFamily: 'rsa',
							rsaModulusBits: 2048,
							signatureAlgorithmId: algo.id,
							notAfter: '2028-01-01',
						}
					: {
							keyFamily: 'ec',
							ecCurve: 'P-256',
							signatureAlgorithmId: algo.id,
							notAfter: '2028-01-01',
						};
			const res = await agent
				.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
				.set(csrfHeader(csrf))
				.send(body)
				.expect(201);
			expect(res.body.signingSignatureAlgorithmId).toBe(algo.id);
			expect(res.body.signingKeyFamily).toBe(algo.keyFamily);
		}
	});

	it('API-IDP-CRYPTO-04: RSA signature with EC key family → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				keyFamily: 'ec',
				ecCurve: 'P-256',
				signatureAlgorithmId: 'rsa-sha256',
				notAfter: '2028-01-01',
			})
			.expect(400);
	});

	it('API-IDP-CRYPTO-06: notAfter more than 10 years → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '2040-01-01' })
			.expect(400);
	});

	it('API-IDP-CRYPTO-07: omitted notAfter uses ~730-day cert validity', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ keyFamily: 'rsa', rsaModulusBits: 2048, signatureAlgorithmId: 'rsa-sha256' })
			.expect(201);
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const notAfterIso = parseCertNotAfterIso(row!.signingCertPem);
		expect(notAfterIso).not.toBeNull();
		const days = (new Date(notAfterIso!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
		expect(days).toBeGreaterThan(700);
		expect(days).toBeLessThan(760);
		expect(res.body.signingRsaModulusBits).toBe(2048);
	});

	it('API-IDP-CRYPTO-09: complete rotation promotes pending crypto to primary', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({
				mode: 'generate',
				keyFamily: 'ec',
				ecCurve: 'P-384',
				signatureAlgorithmId: 'ecdsa-sha384',
				notAfter: '2029-12-31',
			})
			.expect(201);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('ec');
		expect(res.body.signingEcCurve).toBe('P-384');
		expect(res.body.signingSignatureAlgorithmId).toBe('ecdsa-sha384');
		expect(res.body.rotation.pendingSigningKeyFamily).toBeNull();
	});

	it('API-IDP-CRYPTO-10: cancel rotation clears pending crypto columns', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', signatureAlgorithmId: 'rsa-sha512', notAfter: '2028-06-01' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(row!.pendingSigningKeyFamily).toBeNull();
		expect(row!.pendingSigningSignatureAlgorithmId).toBeNull();
		expect(row!.pendingSigningRsaModulusBits).toBeNull();
		expect(row!.pendingSigningEcCurve).toBeNull();
	});

	it('API-IDP-CRYPTO-11: POST generate with {} uses rsa-2048 defaults', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('rsa');
		expect(res.body.signingRsaModulusBits).toBe(2048);
		expect(res.body.signingSignatureAlgorithmId).toBe('rsa-sha256');
	});

	it('API-IDP-CRYPTO-12: upload RSA PEM infers signing crypto columns', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const { certPem, privateKeyPem } = getTestSigningMaterial('http://localhost:3000');
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ signingCertPem: certPem, signingPrivateKeyPem: privateKeyPem })
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('rsa');
		expect(res.body.signingSignatureAlgorithmId).toBe('rsa-sha256');
		expect(res.body.signingRsaModulusBits).toBeGreaterThanOrEqual(2048);
	});

	it('API-IDP-CRYPTO-13: rotation generate pending EC while primary RSA differs', async () => {
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({
				mode: 'generate',
				keyFamily: 'ec',
				ecCurve: 'P-256',
				signatureAlgorithmId: 'ecdsa-sha256',
				notAfter: '2030-03-15',
			})
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('rsa');
		expect(res.body.rotation.pendingSigningKeyFamily).toBe('ec');
		expect(res.body.rotation.pendingSigningSignatureAlgorithmId).toBe('ecdsa-sha256');
		expect(res.body.rotation.pendingSigningEcCurve).toBe('P-256');
	});

	it('API-IDP-CRYPTO-14: rotation upload pending EC while primary RSA differs', async () => {
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		const signing = app.get(IdpSigningService);
		const ec = signing.generateKeyPairAndCert('https://pending-ec.example', {
			keyFamily: 'ec',
			ecCurve: 'P-256',
			signatureAlgorithmId: 'ecdsa-sha256',
			notAfter: '2031-08-01',
		});
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({
				mode: 'upload',
				signingCertPem: ec.certPem,
				signingPrivateKeyPem: ec.privateKeyPem,
			})
			.expect(201);
		expect(res.body.signingKeyFamily).toBe('rsa');
		expect(res.body.rotation.pendingSigningKeyFamily).toBe('ec');
		expect(res.body.rotation.pendingSigningSignatureAlgorithmId).toBe('ecdsa-sha256');
	});

	it('API-IDP-CRYPTO-15: unknown signatureAlgorithmId → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ signatureAlgorithmId: 'hmac-sha999', notAfter: '2028-01-01' })
			.expect(400);
	});

	it('API-IDP-CRYPTO-16: notAfter exactly 10 years from today → 201', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const max = new Date();
		max.setUTCFullYear(max.getUTCFullYear() + 10);
		const iso = `${max.getUTCFullYear()}-${String(max.getUTCMonth() + 1).padStart(2, '0')}-${String(max.getUTCDate()).padStart(2, '0')}`;
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: iso })
			.expect(201);
	});

	it('API-IDP-CRYPTO-17: generate during active rotation → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', notAfter: '2029-01-01' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '2029-02-01' })
			.expect(409);
	});

	it('API-IDP-CRYPTO-18: invalid rsaModulusBits → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ rsaModulusBits: 1024, notAfter: '2028-01-01' })
			.expect(400);
	});

	it('API-IDP-CRYPTO-19: RSA 4096 + rsa-sha512 persists modulus and algorithm', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: null, signingKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				rsaModulusBits: 4096,
				signatureAlgorithmId: 'rsa-sha512',
				notAfter: '2029-12-01',
			})
			.expect(201);
		expect(res.body.signingRsaModulusBits).toBe(4096);
		expect(res.body.signingSignatureAlgorithmId).toBe('rsa-sha512');
	});

	it('API-IDP-CRYPTO-20: CRYPTO-08 extended — pending DTO includes notAfter ISO', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({
				mode: 'generate',
				signatureAlgorithmId: 'rsa-sha384',
				notAfter: '2030-04-15',
			})
			.expect(201);
		expect(res.body.rotation.pendingSigningSignatureAlgorithmId).toBe('rsa-sha384');
		expect(res.body.rotation.pendingSigningCertNotAfter).toMatch(/^2030-04-15T/);
		expect(res.body.rotation.pendingSigningRsaModulusBits).toBe(2048);
	});

	it('API-IDP-ENC-01: POST generate encryption cert sets primary', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ rsaModulusBits: 2048, notAfter: '2029-06-01' })
			.expect(201);
		expect(res.body.hasEncryptionCertificate).toBe(true);
		expect(res.body.encryptionKeyFamily).toBe('rsa');
		expect(res.body.encryptionRsaModulusBits).toBe(2048);
	});

	it('API-IDP-ENC-02: POST generate blocked during encryption rotation → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await createTestIdpSettingsWithEncryptionKey(prisma);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '2029-07-01' })
			.expect(409);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ENC-03: POST upload valid encryption pair', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('http://localhost:3000');
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ encryptionCertPem: certPem, encryptionPrivateKeyPem: privateKeyPem })
			.expect(201);
		expect(res.body.hasEncryptionCertificate).toBe(true);
	});

	it('API-IDP-ENC-04: POST upload signing-only cert → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const { certPem, privateKeyPem } = getTestSigningMaterial('http://localhost:3000');
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ encryptionCertPem: certPem, encryptionPrivateKeyPem: privateKeyPem })
			.expect(400);
	});

	it('API-IDP-ENC-05: POST upload same cert as signing primary → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const signingCert = settings!.signingCertPem!;
		const { privateKeyPem } = generateTestRsaEncryptionCert('http://other.example.com');
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ encryptionCertPem: signingCert, encryptionPrivateKeyPem: privateKeyPem })
			.expect(400);
	});

	it('API-IDP-ENC-06: GET public-pem returns primary cert only', async () => {
		await createTestIdpSettingsWithEncryptionKey(prisma);
		const agent = await adminAgent();
		const res = await agent.get(`${IDP_SETTINGS_API_PATH}/encryption-cert/public-pem`).expect(200);
		expect(res.body.certPem).toContain('BEGIN CERTIFICATE');
		expect(res.body.certPem).not.toContain('PRIVATE KEY');
	});

	it('API-IDP-ENC-07: GET public-pem without cert → 404', async () => {
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		const agent = await adminAgent();
		await agent.get(`${IDP_SETTINGS_API_PATH}/encryption-cert/public-pem`).expect(404);
	});

	it('API-IDP-ENC-08: encryption rotation complete promotes pending', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await createTestIdpSettingsWithEncryptionKey(prisma);
		const before = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', rsaModulusBits: 3072 })
			.expect(201);
		const pendingFp = (await agent.get(IDP_SETTINGS_API_PATH).expect(200)).body.encryptionRotation
			.pendingCertFingerprintSha256;
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/complete`)
			.set(csrfHeader(csrf))
			.expect(201);
		const after = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(after.body.encryptionCertFingerprintSha256).toBe(pendingFp);
		expect(after.body.encryptionRsaModulusBits).toBe(3072);
		expect(after.body.encryptionRotation.active).toBe(false);
		expect(before.body.encryptionCertFingerprintSha256).not.toBe(pendingFp);
	});

	it('API-IDP-ENC-09: signing rotation does not block encryption generate', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '2029-08-01' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ENC-10: POST encryption generate without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginCsrf(agent);
		await agent.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`).expect(403);
	});

	it('API-IDP-ENC-11: generate EC P-256 sets encryptionKeyTransportAlgorithmId null', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ keyFamily: 'ec', ecCurve: 'P-256', notAfter: '2029-09-01' })
			.expect(201);
		expect(res.body.encryptionKeyFamily).toBe('ec');
		expect(res.body.encryptionEcCurve).toBe('P-256');
		expect(res.body.encryptionKeyTransportAlgorithmId).toBeNull();
	});

	it('API-IDP-ENC-12: EC generate with keyTransportAlgorithmId → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				keyFamily: 'ec',
				ecCurve: 'P-256',
				keyTransportAlgorithmId: 'rsa-oaep-mgf1p',
				notAfter: '2029-09-02',
			})
			.expect(400);
	});

	it('API-IDP-ENC-13: RSA generate with rsa-oaep transport persists id', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({
				keyTransportAlgorithmId: 'rsa-oaep',
				notAfter: '2029-10-01',
			})
			.expect(201);
		expect(res.body.encryptionKeyTransportAlgorithmId).toBe('rsa-oaep');
	});

	it('API-IDP-ENC-ADM-02: POST encryption rotation complete without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginCsrf(agent);
		await agent.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/complete`).expect(403);
	});

	it('API-IDP-ENC-14: POST generate with {} uses RSA-2048 rsa-oaep-mgf1p defaults', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({})
			.expect(201);
		expect(res.body.encryptionKeyFamily).toBe('rsa');
		expect(res.body.encryptionRsaModulusBits).toBe(2048);
		expect(res.body.encryptionKeyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
	});

	it('API-IDP-ENC-15: notAfter in the past → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter: '2020-01-01' })
			.expect(400);
	});

	it('API-IDP-ENC-16: notAfter more than ten years ahead → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const far = new Date();
		far.setUTCFullYear(far.getUTCFullYear() + 11);
		const notAfter = far.toISOString().slice(0, 10);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ notAfter })
			.expect(400);
	});

	it('API-IDP-ENC-17: each RSA key transport algorithm id accepted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		for (const keyTransportAlgorithmId of ['rsa-oaep-mgf1p', 'rsa-oaep', 'rsa-1_5']) {
			await prisma.idpSettings.update({
				where: { id: 'default' },
				data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
			});
			const res = await agent
				.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
				.set(csrfHeader(csrf))
				.send({ keyTransportAlgorithmId, notAfter: '2029-11-01' })
				.expect(201);
			expect(res.body.encryptionKeyTransportAlgorithmId).toBe(keyTransportAlgorithmId);
		}
	});

	it('API-IDP-ENC-18: upload RSA encryption pair infers default transport', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert(
			'https://upload-inf.example.com',
		);
		const res = await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ encryptionCertPem: certPem, encryptionPrivateKeyPem: privateKeyPem })
			.expect(201);
		expect(res.body.encryptionKeyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
		expect(res.body.encryptionKeyFamily).toBe('rsa');
	});

	it('API-IDP-ENC-19: GET settings never exposes encryption PEM or private key', async () => {
		await createTestIdpSettingsWithEncryptionKey(prisma);
		const agent = await adminAgent();
		const res = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('BEGIN PRIVATE KEY');
		expect(body).not.toContain('encryptionPrivateKeyPem');
		expect(body).not.toContain('encryptionKeyEncrypted');
		expect(res.body.encryptionCertFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('API-IDP-ENC-20: encryption rotation cancel clears pending crypto columns', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await createTestIdpSettingsWithEncryptionKey(prisma);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', rsaModulusBits: 4096, notAfter: '2029-12-15' })
			.expect(201);
		const pendingRow = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(pendingRow?.pendingEncryptionRsaModulusBits).toBe(4096);
		expect(pendingRow?.pendingEncryptionKeyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(row?.pendingEncryptionCertPem).toBeNull();
		expect(row?.pendingEncryptionKeyTransportAlgorithmId).toBeNull();
		expect(row?.encryptionRotationStartedAt).toBeNull();
		const dto = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(dto.body.encryptionRotation.active).toBe(false);
	});

	it('API-IDP-ENC-21: signing and encryption rotation may run simultaneously', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await createTestIdpSettingsWithEncryptionKey(prisma);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate', rsaModulusBits: 3072 })
			.expect(201);
		const settings = await agent.get(IDP_SETTINGS_API_PATH).expect(200);
		expect(settings.body.rotation.active).toBe(true);
		expect(settings.body.encryptionRotation.active).toBe(true);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ENC-22: upload encryption cert blocked during encryption rotation → 409', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await createTestIdpSettingsWithEncryptionKey(prisma);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.set(csrfHeader(csrf))
			.send({ mode: 'generate' })
			.expect(201);
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('https://blocked.example.com');
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.set(csrfHeader(csrf))
			.send({ encryptionCertPem: certPem, encryptionPrivateKeyPem: privateKeyPem })
			.expect(409);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`)
			.set(csrfHeader(csrf))
			.expect(201);
	});

	it('API-IDP-ENC-ADM-01: POST encryption rotation start without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginCsrf(agent);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`)
			.send({ mode: 'generate' })
			.expect(403);
	});

	it('API-IDP-ENC-ADM-03: POST encryption upload without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginCsrf(agent);
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert(
			'https://csrf-upload.example.com',
		);
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`)
			.send({ encryptionCertPem: certPem, encryptionPrivateKeyPem: privateKeyPem })
			.expect(403);
	});

	it('API-AUDIT-ENC-01: encryption generate audit metadata has no PEM', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginCsrf(agent);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { encryptionCertPem: null, encryptionKeyEncrypted: null },
		});
		await agent
			.post(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`)
			.set(csrfHeader(csrf))
			.send({ rsaModulusBits: 3072, keyTransportAlgorithmId: 'rsa-oaep', notAfter: '2029-12-01' })
			.expect(201);
		const row = await waitForEncryptionCertGeneratedAudit(prisma, (metadata) => {
			const meta = JSON.stringify(metadata);
			return meta.includes('rsa-oaep') && meta.includes('3072');
		});
		expect(row).not.toBeNull();
		const meta = JSON.stringify(row!.metadata);
		expect(meta).toContain('rsa-oaep');
		expect(meta).toContain('3072');
		expect(meta).not.toContain('BEGIN CERTIFICATE');
		expect(meta).not.toContain('BEGIN PRIVATE KEY');
	});
});
