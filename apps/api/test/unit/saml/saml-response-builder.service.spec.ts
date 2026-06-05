import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { EncryptionService } from '@api/encryption/services/encryption.service';
import { encrypt } from '@api/encryption/utils/encryption.util';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	TEST_ENCRYPTION_KEY,
} from '@test/support/prisma/test-fixtures';
import { IdpSigningService } from '@api/saml/services/idp-signing.service';
import { SamlAuthAuditService } from '@api/saml/services/saml-auth-audit.service';
import { SamlAttributeMapperService } from '@api/saml/services/saml-attribute-mapper.service';
import { SamlResponseBuilderService } from '@api/saml/services/saml-response-builder.service';
import { verifySamlXmlSignature } from '@test/support/saml/verify-saml-signature.util';

jest.setTimeout(60_000);

describe('SamlResponseBuilderService (SQLite)', () => {
	let prisma: PrismaClient;
	let builder: SamlResponseBuilderService;
	let databaseUrl: string;

	const user = {
		id: 'u1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice',
		groups: ['G1'],
		roles: ['R1'],
	};

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-saml-build-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		const configService = {
			get: (key: string) => {
				if (key === 'ENCRYPTION_KEY') return TEST_ENCRYPTION_KEY;
				if (key === 'SAML_ASSERTION_TTL_SECONDS') return 300;
				if (key === 'SAML_CLOCK_SKEW_SECONDS') return 120;
				return undefined;
			},
		} as unknown as ConfigService;
		const encryptionService = new EncryptionService(configService);
		const audit = new SamlAuthAuditService({ recordSafe: jest.fn() } as never);
		const idpSigning = new IdpSigningService(
			prisma as unknown as PrismaService,
			encryptionService,
			configService,
			audit,
		);
		builder = new SamlResponseBuilderService(
			configService,
			new SamlAttributeMapperService(),
			idpSigning,
		);
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	async function buildForSp(overrides: Parameters<typeof createTestSpConnection>[1] = {}) {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: `urn:sp:build-${Date.now()}`,
			acsUrl: 'https://sp.example.com/acs',
			...overrides,
		});
		return builder.buildLoginResponse({
			authnRequest: {
				id: '_authn-req-123',
				issuer: sp.spEntityId,
				issueInstant: new Date().toISOString(),
			},
			user,
			spConnection: sp,
			idpEntityId: 'http://localhost:3000',
		});
	}

	it('API-SAML-BUILD-01: InResponseTo matches authnRequest id', async () => {
		const { samlResponseXml } = await buildForSp();
		expect(samlResponseXml).toContain('InResponseTo="_authn-req-123"');
	});

	it('API-SAML-BUILD-02: Status Success', async () => {
		const { samlResponseXml } = await buildForSp();
		expect(samlResponseXml).toContain('status:Success');
		expect(samlResponseXml).toMatch(/StatusCode[^>]*Success/);
	});

	it('API-SAML-BUILD-03: contains signed Assertion', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('saml2:Assertion');
		expect(assertionXml).toContain('Signature');
	});

	it('API-SAML-BUILD-04: Audience is SP entity ID', async () => {
		const sp = await createTestSpConnection(prisma, {
			spEntityId: 'urn:sp:audience-test',
		});
		const { samlResponseXml } = await builder.buildLoginResponse({
			authnRequest: { id: '_a1', issuer: sp.spEntityId, issueInstant: new Date().toISOString() },
			user,
			spConnection: sp,
			idpEntityId: 'http://localhost:3000',
		});
		expect(samlResponseXml).toContain('urn:sp:audience-test');
	});

	it('API-SAML-BUILD-05: Conditions NotBefore and NotOnOrAfter present', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('NotBefore=');
		expect(assertionXml).toContain('NotOnOrAfter=');
	});

	it('API-SAML-BUILD-06: AuthnStatement present', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('AuthnStatement');
	});

	it('API-SAML-BUILD-07: default email attribute when mapping null', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('email');
		expect(assertionXml).toContain('alice@example.com');
	});

	it('API-SAML-BUILD-08: custom attribute mapping', async () => {
		const { assertionXml } = await buildForSp({
			attributeMapping: { attributes: [{ samlName: 'login', source: 'username' }] },
		});
		expect(assertionXml).toContain('login');
		expect(assertionXml).toContain('alice');
	});

	it('API-SAML-BUILD-09: NameID username when email null', async () => {
		const sp = await createTestSpConnection(prisma);
		const { assertionXml } = await builder.buildLoginResponse({
			authnRequest: { id: '_a2', issuer: sp.spEntityId, issueInstant: new Date().toISOString() },
			user: { ...user, email: null },
			spConnection: sp,
			idpEntityId: 'http://localhost:3000',
		});
		expect(assertionXml).toContain('>alice<');
	});

	it('API-SAML-BUILD-10: Response Destination equals ACS URL', async () => {
		const acs = 'https://sp.example.com/acs?tenant=1';
		const { samlResponseXml } = await buildForSp({ acsUrl: acs });
		expect(samlResponseXml).toContain(`Destination="${acs}"`);
	});

	it('API-SAML-BUILD-11: Response Version 2.0', async () => {
		const { samlResponseXml } = await buildForSp();
		expect(samlResponseXml).toMatch(/<saml2p:Response[^>]*Version="2.0"/);
	});

	it('API-SAML-BUILD-12: Response ID is non-empty underscore-prefixed', async () => {
		const { samlResponseXml } = await buildForSp();
		const match = samlResponseXml.match(/<saml2p:Response[^>]*ID="(_[^"]+)"/);
		expect(match?.[1].length).toBeGreaterThan(2);
	});

	it('API-SAML-BUILD-13: AuthnStatement SessionIndex present', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toMatch(/AuthnStatement[^>]*SessionIndex="/);
	});

	it('API-SAML-BUILD-14: Assertion Issuer is IdP entity ID', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('<saml2:Issuer>http://localhost:3000</saml2:Issuer>');
	});

	it('API-SAML-BUILD-15: default mapping emits memberOf and role', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('memberOf');
		expect(assertionXml).toContain('G1');
		expect(assertionXml).toContain('role');
		expect(assertionXml).toContain('R1');
	});

	it('API-SAML-BUILD-16: default mapping emits displayName', async () => {
		const { assertionXml } = await buildForSp();
		expect(assertionXml).toContain('displayName');
		expect(assertionXml).toContain('Alice');
	});

	it('API-SAML-BUILD-17: custom mapping with empty sources omits AttributeStatement', async () => {
		const { assertionXml } = await buildForSp({
			attributeMapping: { attributes: [{ samlName: 'missing', source: 'unknown-field' }] },
		});
		expect(assertionXml).not.toContain('AttributeStatement');
	});

	it('API-SAML-BUILD-18: escapes ampersand in ACS URL for Destination', async () => {
		const acs = 'https://sp.example.com/acs?a=1&b=2';
		const { samlResponseXml } = await buildForSp({ acsUrl: acs });
		expect(samlResponseXml).toContain('Destination="https://sp.example.com/acs?a=1&amp;b=2"');
		expect(samlResponseXml).not.toContain('?a=1&b=2"');
	});

	it('API-SAML-BUILD-19: escapes special XML in displayName attribute value', async () => {
		const sp = await createTestSpConnection(prisma);
		const { assertionXml } = await builder.buildLoginResponse({
			authnRequest: { id: '_a3', issuer: sp.spEntityId, issueInstant: new Date().toISOString() },
			user: { ...user, displayName: 'A & B <C>' },
			spConnection: sp,
			idpEntityId: 'http://localhost:3000',
		});
		expect(assertionXml).toContain('A &amp; B &lt;C&gt;');
	});

	it('API-SAML-BUILD-20: NameID Format from SP connection', async () => {
		const format = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
		const { assertionXml } = await buildForSp({ nameIdFormat: format });
		expect(assertionXml).toContain(`Format="${format}"`);
	});

	it('API-SAML-BUILD-21: Recipient equals acsUrl', async () => {
		const acs = 'https://sp.custom.example/acs/path';
		const { assertionXml } = await buildForSp({ acsUrl: acs });
		expect(assertionXml).toContain(`Recipient="${acs}"`);
	});

	it('API-SAML-BUILD-22: SubjectConfirmationData NotOnOrAfter parseable', async () => {
		const { assertionXml } = await buildForSp();
		const match = assertionXml.match(/SubjectConfirmationData[^>]*NotOnOrAfter="([^"]+)"/);
		expect(match).toBeTruthy();
		expect(Number.isNaN(Date.parse(match![1]))).toBe(false);
	});

	it('API-SAML-BUILD-23: signature verifies cryptographically', async () => {
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const { samlResponseXml } = await buildForSp();
		expect(verifySamlXmlSignature(samlResponseXml, settings!.signingCertPem!)).toBe(true);
	});

	it('API-SAML-SIGN-18: stored rsa-sha384 primary appears in signed Response', async () => {
		const generated = new IdpSigningService(
			prisma as never,
			new EncryptionService({
				get: (key: string) => (key === 'ENCRYPTION_KEY' ? TEST_ENCRYPTION_KEY : undefined),
			} as never),
			{ get: () => undefined } as never,
			new SamlAuthAuditService({ recordSafe: jest.fn() } as never),
		).generateKeyPairAndCert('http://localhost:3000', {
			keyFamily: 'rsa',
			rsaModulusBits: 2048,
			signatureAlgorithmId: 'rsa-sha384',
			notAfter: '2030-06-01',
		});
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: generated.certPem,
				signingKeyEncrypted: encrypt(generated.privateKeyPem, TEST_ENCRYPTION_KEY),
				signingKeyFamily: 'rsa',
				signingSignatureAlgorithmId: 'rsa-sha384',
				signingRsaModulusBits: 2048,
				signingEcCurve: null,
			},
		});
		const { samlResponseXml } = await buildForSp();
		expect(samlResponseXml).toContain('xmldsig-more#rsa-sha384');
		expect(verifySamlXmlSignature(samlResponseXml, generated.certPem)).toBe(true);
	});
});
