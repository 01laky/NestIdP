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
import { ADMIN_CSRF_HEADER_NAME, SP_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { decodeRedirectBinding } from '@api/saml/utils/build-authn-request.util';
import { SpConnectionsModule } from '@api/sp-connections/sp-connections.module';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	createTestAdminUserWithPassword,
	createTestIdpSettingsWithEncryptionKey,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	createTestSpConnectionWithSigningKey,
	getTestSigningMaterial,
} from '@test/support/prisma/test-fixtures';
import { SamlModule } from '@api/saml/saml.module';

jest.setTimeout(90_000);

describe('SP request security integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'sp-security-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sp-security-${randomUUID()}.db`);
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

	it('API-SP-REQ-SIG-01: create signed-required SP without certificate is rejected', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Signed Required No Cert',
				spEntityId: `urn:test:sp:req-sig-no-cert:${Date.now()}`,
				acsUrl: 'https://sp.example.com/acs',
				wantAuthnRequestsSigned: true,
			})
			.expect(400);
	});

	it('API-SP-REQ-SIG-02: create signed-required SP with certificate succeeds', async () => {
		const { agent, csrf } = await adminCsrfAgent();
		const certPem = getTestSigningMaterial('urn:test:sp:req-sig-create').certPem;
		const res = await agent
			.post(SP_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Signed Required',
				spEntityId: `urn:test:sp:req-sig-create:${Date.now()}`,
				acsUrl: 'https://sp.example.com/acs',
				spCertificate: certPem,
				wantAuthnRequestsSigned: true,
			})
			.expect(201);
		expect(res.body.item.wantAuthnRequestsSigned).toBe(true);
		expect(res.body.item.hasSpCertificate).toBe(true);
	});

	it('API-SP-REQ-SIG-03: patch enabling signed-required without certificate is rejected', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:req-sig-patch:${Date.now()}`,
			spCertificate: null,
			wantAuthnRequestsSigned: false,
		});
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.patch(`${SP_CONNECTIONS_API_PATH}/${sp.id}`)
			.set(csrfHeader(csrf))
			.send({ wantAuthnRequestsSigned: true })
			.expect(400);
	});

	it('API-SP-TEST-SSO-01: default test SSO URL is unsigned', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:test-sso-default:${Date.now()}`,
		});
		const { agent } = await adminCsrfAgent();
		const res = await agent.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}/test-sso-url`).expect(200);
		const url = new URL(res.body.ssoUrl);
		expect(res.body.signed).toBe(false);
		expect(url.searchParams.get('SigAlg')).toBeNull();
		expect(url.searchParams.get('Signature')).toBeNull();
	});

	it('API-SP-TEST-SSO-02: signed test SSO URL includes redirect signature params', async () => {
		const { spConnection } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:test-sso-signed:${Date.now()}`,
		});
		const { agent } = await adminCsrfAgent();
		const res = await agent
			.get(`${SP_CONNECTIONS_API_PATH}/${spConnection.id}/test-sso-url?signed=true`)
			.expect(200);
		const url = new URL(res.body.ssoUrl);
		expect(res.body.signed).toBe(true);
		expect(url.searchParams.get('SigAlg')).toBeTruthy();
		expect(url.searchParams.get('Signature')).toBeTruthy();
		expect(res.body.warning).toBe('signed_with_ephemeral_key_verify_sp_cert_matches');
	});

	it('API-SP-TEST-SSO-03: encrypted test SSO URL requires IdP encryption certificate', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:test-sso-encrypted-missing:${Date.now()}`,
		});
		const { agent } = await adminCsrfAgent();
		await agent
			.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}/test-sso-url?encrypted=true`)
			.expect(400);
	});

	it('API-SP-TEST-SSO-04: encrypted test SSO URL carries encrypted SAMLRequest', async () => {
		await createTestIdpSettingsWithEncryptionKey(prisma, { entityId: 'http://localhost:3000' });
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:test-sso-encrypted:${Date.now()}`,
		});
		const { agent } = await adminCsrfAgent();
		const res = await agent
			.get(`${SP_CONNECTIONS_API_PATH}/${sp.id}/test-sso-url?encrypted=true`)
			.expect(200);
		const url = new URL(res.body.ssoUrl);
		const samlRequest = url.searchParams.get('SAMLRequest');
		expect(res.body.encrypted).toBe(true);
		expect(samlRequest).toBeTruthy();
		const xml = decodeRedirectBinding(decodeURIComponent(samlRequest!));
		expect(xml).toContain('xenc:EncryptedData');
	});

	it('API-SP-PROBE-SIG-01: signing probe succeeds for matching private key and certificate', async () => {
		const { spConnection, spPrivateKeyPem } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:probe-ok:${Date.now()}`,
		});
		const { agent, csrf } = await adminCsrfAgent();
		const res = await agent
			.post(`${SP_CONNECTIONS_API_PATH}/${spConnection.id}/probe-sp-signing`)
			.set(csrfHeader(csrf))
			.send({ spPrivateKeyPem })
			.expect(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('API-SP-PROBE-SIG-02: signing probe fails for mismatched private key', async () => {
		const { spConnection } = await createTestSpConnectionWithSigningKey(prisma, {
			spEntityId: `urn:test:sp:probe-mismatch:${Date.now()}`,
		});
		const mismatchKey = getTestSigningMaterial('urn:test:sp:probe-other').privateKeyPem;
		const { agent, csrf } = await adminCsrfAgent();
		const res = await agent
			.post(`${SP_CONNECTIONS_API_PATH}/${spConnection.id}/probe-sp-signing`)
			.set(csrfHeader(csrf))
			.send({ spPrivateKeyPem: mismatchKey })
			.expect(200);
		expect(res.body.ok).toBe(false);
		expect(res.body.message).toContain('does not match');
	});

	it('API-SP-PROBE-SIG-03: signing probe rejects SP without certificate', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:probe-no-cert:${Date.now()}`,
			spCertificate: null,
		});
		const privateKeyPem = getTestSigningMaterial('urn:test:sp:probe-no-cert').privateKeyPem;
		const { agent, csrf } = await adminCsrfAgent();
		await agent
			.post(`${SP_CONNECTIONS_API_PATH}/${sp.id}/probe-sp-signing`)
			.set(csrfHeader(csrf))
			.send({ spPrivateKeyPem: privateKeyPem })
			.expect(400);
	});

	async function adminCsrfAgent(): Promise<{ agent: request.Agent; csrf: string }> {
		const agent = request.agent(app.getHttpServer() as App);
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return { agent, csrf: login.body.csrfToken as string };
	}

	function csrfHeader(token: string): Record<string, string> {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}
});
