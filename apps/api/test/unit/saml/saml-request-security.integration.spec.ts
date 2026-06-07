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
import { SAML_REQUEST_QUERY_PARAM } from '@nestidp/shared';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	buildAuthnRequestXml,
	encodeRedirectBinding,
} from '@api/saml/utils/build-authn-request.util';
import { encryptAuthnRequestForIdp } from '@api/saml/utils/encrypt-authn-request-for-idp.util';
import { buildSignedAuthnRequestRedirectQuery } from '@api/saml/utils/sign-authn-request-redirect.util';
import { SamlModule } from '@api/saml/saml.module';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	createTestIdpSettingsWithEncryptionKey,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	createTestSpConnectionWithSigningKey,
	getTestSigningMaterial,
} from '@test/support/prisma/test-fixtures';

jest.setTimeout(90_000);

describe('SAML request security integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-saml-req-security-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);

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
	});

	afterEach(async () => {
		await prisma.auditEvent.deleteMany();
		await prisma.samlSession.deleteMany();
		await prisma.spConnection.deleteMany();
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				encryptionCertPem: null,
				encryptionKeyEncrypted: null,
				encryptionKeyFamily: null,
				encryptionKeyTransportAlgorithmId: null,
				encryptionRsaModulusBits: null,
				encryptionEcCurve: null,
				pendingEncryptionCertPem: null,
				pendingEncryptionKeyEncrypted: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				encryptionRotationStartedAt: null,
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

	it('API-SAML-REQ-INT-01: unsigned AuthnRequest allowed when SP does not require signatures', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:unsigned-ok:${Date.now()}`,
			wantAuthnRequestsSigned: false,
		});
		const query = buildUnsignedSsoQuery(sp.spEntityId, `_unsigned-${Date.now()}`);
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(302);
	});

	it('API-SAML-REQ-INT-02: unsigned AuthnRequest rejected when SP requires signatures', async () => {
		const cert = getTestSigningMaterial('urn:test:sp:req-signed').certPem;
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:unsigned-reject:${Date.now()}`,
			spCertificate: cert,
			wantAuthnRequestsSigned: true,
		});
		const query = buildUnsignedSsoQuery(sp.spEntityId, `_unsigned-reject-${Date.now()}`);
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(400);
		expect(String(res.body.message)).toContain('Signed AuthnRequest is required');
	});

	it('API-SAML-REQ-INT-03: valid signed AuthnRequest accepted for signed-required SP', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:signed-ok:${Date.now()}`,
			wantAuthnRequestsSigned: true,
		});
		const query = buildSignedSsoQuery({
			spEntityId: spConnection.spEntityId,
			requestId: `_signed-ok-${Date.now()}`,
			spPrivateKeyPem,
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(302);
	});

	it('API-SAML-REQ-INT-04: tampered signature is rejected', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:bad-signature:${Date.now()}`,
			wantAuthnRequestsSigned: true,
		});
		const query = buildSignedSsoQuery({
			spEntityId: spConnection.spEntityId,
			requestId: `_signed-bad-${Date.now()}`,
			spPrivateKeyPem,
		});
		const tampered = query.replace(/Signature=[^&]+/, 'Signature=dGFtcGVyZWQ%3D');
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${tampered}`)
			.expect(400);
		expect(String(res.body.message)).toContain('Invalid SAMLRequest signature');
	});

	it('API-SAML-REQ-INT-05: missing SigAlg/Signature pair is rejected', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:invalid-params:${Date.now()}`,
		});
		const base = buildUnsignedSsoQuery(sp.spEntityId, `_invalid-params-${Date.now()}`);
		const query = `${base}&Signature=dGVzdA%3D%3D`;
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(400);
		expect(String(res.body.message)).toContain('Invalid SAMLRequest signature parameters');
	});

	it('API-SAML-REQ-INT-06: unsupported SigAlg URI is rejected', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:unsupported-sigalg:${Date.now()}`,
			wantAuthnRequestsSigned: true,
		});
		const query = buildSignedSsoQuery({
			spEntityId: spConnection.spEntityId,
			requestId: `_unsupported-${Date.now()}`,
			spPrivateKeyPem,
		}).replace(
			/SigAlg=[^&]+/,
			`SigAlg=${encodeURIComponent(encodeURIComponent('urn:unsupported:signature'))}`,
		);
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(400);
		expect(String(res.body.message)).toContain('Unsupported SAMLRequest signature algorithm');
	});

	it('API-SAML-REQ-INT-07: signed request without SP certificate is rejected', async () => {
		const signing = getTestSigningMaterial('urn:test:sp:no-cert-sign');
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:no-cert:${Date.now()}`,
			spCertificate: null,
			wantAuthnRequestsSigned: false,
		});
		const query = buildSignedSsoQuery({
			spEntityId: sp.spEntityId,
			requestId: `_no-cert-${Date.now()}`,
			spPrivateKeyPem: signing.privateKeyPem,
		});
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(400);
		expect(String(res.body.message)).toContain('SP certificate is required');
	});

	it('API-SAML-REQ-INT-08: encrypted AuthnRequest is decrypted when IdP encryption key exists', async () => {
		const settings = await createTestIdpSettingsWithEncryptionKey(prisma, {
			entityId: 'http://localhost:3000',
		});
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:encrypted-ok:${Date.now()}`,
		});
		const encryptedQuery = buildEncryptedSsoQuery({
			spEntityId: sp.spEntityId,
			requestId: `_encrypted-ok-${Date.now()}`,
			idpEncryptionCertPem: settings.encryptionCertPem!,
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${encryptedQuery}`)
			.expect(302);
	});

	it('API-SAML-REQ-INT-09: encrypted AuthnRequest fails when IdP key is not configured', async () => {
		const cert = getTestSigningMaterial('urn:test:idp:missing-key').certPem;
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:encrypted-missing-key:${Date.now()}`,
		});
		const encryptedQuery = buildEncryptedSsoQuery({
			spEntityId: sp.spEntityId,
			requestId: `_encrypted-missing-${Date.now()}`,
			idpEncryptionCertPem: cert,
		});
		const res = await request(app.getHttpServer() as App)
			.get(`/saml/sso?${encryptedQuery}`)
			.expect(400);
		expect(String(res.body.message)).toContain('IdP encryption certificate is not configured');
	});

	it('API-SAML-REQ-AUDIT-01: valid signed request emits saml_request_signature_verified audit event', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:audit-signed:${Date.now()}`,
			wantAuthnRequestsSigned: true,
		});
		const query = buildSignedSsoQuery({
			spEntityId: spConnection.spEntityId,
			requestId: `_audit-signed-${Date.now()}`,
			spPrivateKeyPem,
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(302);

		const row = await waitForAuditEvent('saml_request_signature_verified');
		expect(row).not.toBeNull();
		expect(row?.metadata).toMatchObject({
			spEntityId: spConnection.spEntityId,
			sigAlgUri: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		});
	});

	it('API-SAML-REQ-AUDIT-02: decrypted encrypted request emits saml_request_decrypted event', async () => {
		const settings = await createTestIdpSettingsWithEncryptionKey(prisma, {
			entityId: 'http://localhost:3000',
		});
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:audit-decrypted:${Date.now()}`,
		});
		const query = buildEncryptedSsoQuery({
			spEntityId: sp.spEntityId,
			requestId: `_audit-decrypted-${Date.now()}`,
			idpEncryptionCertPem: settings.encryptionCertPem!,
		});
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${query}`)
			.expect(302);

		const row = await waitForAuditEvent('saml_request_decrypted');
		expect(row).not.toBeNull();
		expect(row?.metadata).toMatchObject({ spEntityId: sp.spEntityId });
	});

	it('API-SAML-REQ-AUDIT-03: invalid signature emits rejected audit reason', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:audit-rejected:${Date.now()}`,
			wantAuthnRequestsSigned: true,
		});
		const query = buildSignedSsoQuery({
			spEntityId: spConnection.spEntityId,
			requestId: `_audit-rejected-${Date.now()}`,
			spPrivateKeyPem,
		});
		const tampered = query.replace(/Signature=[^&]+/, 'Signature=ZmFrZQ%3D%3D');
		await request(app.getHttpServer() as App)
			.get(`/saml/sso?${tampered}`)
			.expect(400);

		const row = await waitForAuditEvent('saml_request_rejected');
		expect(row).not.toBeNull();
		expect(row?.metadata).toMatchObject({ reason: 'invalid_saml_request_signature' });
	});

	function buildUnsignedSsoQuery(spEntityId: string, requestId: string): string {
		const xml = buildAuthnRequestXml({
			id: requestId,
			issuer: spEntityId,
			destination: 'http://localhost:3000/saml/sso',
		});
		return `${SAML_REQUEST_QUERY_PARAM}=${encodeURIComponent(encodeRedirectBinding(xml))}`;
	}

	function buildSignedSsoQuery(options: {
		spEntityId: string;
		requestId: string;
		spPrivateKeyPem: string;
		relayState?: string;
	}): string {
		const xml = buildAuthnRequestXml({
			id: options.requestId,
			issuer: options.spEntityId,
			destination: 'http://localhost:3000/saml/sso',
		});
		const samlRequestRaw = encodeURIComponent(encodeRedirectBinding(xml));
		const relayStateRaw = options.relayState ? encodeURIComponent(options.relayState) : undefined;
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			spPrivateKeyPem: options.spPrivateKeyPem,
			relayStateRaw,
		});
		const queryParts = [`SAMLRequest=${samlRequestRaw}`];
		if (relayStateRaw) {
			queryParts.push(`RelayState=${relayStateRaw}`);
		}
		queryParts.push(`SigAlg=${signed.sigAlg}`);
		queryParts.push(`Signature=${signed.signature}`);
		return queryParts.join('&');
	}

	function buildEncryptedSsoQuery(options: {
		spEntityId: string;
		requestId: string;
		idpEncryptionCertPem: string;
	}): string {
		const xml = buildAuthnRequestXml({
			id: options.requestId,
			issuer: options.spEntityId,
			destination: 'http://localhost:3000/saml/sso',
		});
		const encryptedXml = encryptAuthnRequestForIdp(xml, options.idpEncryptionCertPem);
		const encoded = encodeURIComponent(encodeRedirectBinding(encryptedXml));
		return `${SAML_REQUEST_QUERY_PARAM}=${encoded}`;
	}

	async function waitForAuditEvent(event: string) {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const row = await prisma.auditEvent.findFirst({
				where: { event },
				orderBy: { createdAt: 'desc' },
			});
			if (row) {
				return row;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return null;
	}
});
