import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { IdpEncryptionService } from '@api/saml/services/idp-encryption.service';
import { IdpSigningService } from '@api/saml/services/idp-signing.service';
import { SamlAuthAuditService } from '@api/saml/services/saml-auth-audit.service';
import { SamlMetadataService } from '@api/saml/services/saml-metadata.service';
import { encrypt } from '@api/encryption/utils/encryption.util';
import { getTestSigningMaterial, TEST_ENCRYPTION_KEY } from '@test/support/prisma/test-fixtures';

describe('SamlMetadataService', () => {
	const prisma = {
		idpSettings: {
			findUnique: jest.fn(),
		},
	};
	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'IDP_BASE_URL') return 'http://localhost:3000';
			if (key === 'SAML_METADATA_INCLUDE_ACS') return 'true';
			return undefined;
		}),
	} as unknown as ConfigService;

	const audit = { logSigningKeyGenerated: jest.fn() } as unknown as SamlAuthAuditService;
	const encryptionService = {
		encrypt: (v: string) => encrypt(v, TEST_ENCRYPTION_KEY),
		decrypt: jest.fn(),
	};
	const idpSigning = new IdpSigningService(
		prisma as unknown as PrismaService,
		encryptionService as never,
		configService,
		audit,
	);

	const idpEncryption = {
		getMetadataEncryptionCertificates: jest.fn().mockResolvedValue([]),
		extractX509CertificatePem: (pem: string) => pem.replace(/\s/g, ''),
	} as unknown as IdpEncryptionService;

	const service = new SamlMetadataService(
		prisma as unknown as PrismaService,
		configService,
		idpSigning,
		idpEncryption,
	);

	beforeEach(() => {
		const { privateKeyPem, certPem } = getTestSigningMaterial('http://localhost:3000');
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: false,
			signingCertPem: certPem,
			signingKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
		});
	});

	it('API-SAML-META-01: contains entity ID', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('entityID="http://localhost:3000"');
	});

	it('API-SAML-META-02: contains SSO URL', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('http://localhost:3000/saml/sso');
	});

	it('API-SAML-META-03: contains X509 certificate', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('X509Certificate');
	});

	it('API-SAML-META-04: well-formed XML declaration', async () => {
		const xml = await service.generateMetadata();
		expect(xml.startsWith('<?xml')).toBe(true);
	});

	it('API-SAML-META-05: does not contain private key PEM header', async () => {
		const xml = await service.generateMetadata();
		expect(xml).not.toContain('BEGIN PRIVATE KEY');
		expect(xml).not.toContain('BEGIN RSA PRIVATE KEY');
	});

	it('API-SAML-META-06: SSO binding is HTTP-Redirect', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"');
	});

	it('API-SAML-META-07: wantAuthnRequestsSigned is false', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('wantAuthnRequestsSigned="false"');
	});

	it('API-SLO-META-01: advertises POST + Redirect SingleLogoutService at /saml/slo', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
		);
		expect(xml).toContain(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"',
		);
		expect(xml).toMatch(/SingleLogoutService[^>]*Location="[^"]*\/saml\/slo"/);
	});

	it('API-SLO-META-02: SLO POST binding element precedes the Redirect binding element', async () => {
		const xml = await service.generateMetadata();
		const postIdx = xml.indexOf(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
		);
		const redirectIdx = xml.indexOf(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"',
		);
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(postIdx).toBeLessThan(redirectIdx);
	});

	it('API-SLO-META-03: SingleLogoutService appears before NameIDFormat', async () => {
		const xml = await service.generateMetadata();
		expect(xml.indexOf('SingleLogoutService')).toBeLessThan(xml.indexOf('NameIDFormat'));
	});

	it('API-SAML-META-REQ-01: metadata advertises wantAuthnRequestsSigned=true when enabled', async () => {
		const signing = getTestSigningMaterial('http://localhost:3000');
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: true,
			signingCertPem: signing.certPem,
			signingKeyEncrypted: encrypt(signing.privateKeyPem, TEST_ENCRYPTION_KEY),
		});
		const xml = await service.generateMetadata();
		expect(xml).toContain('wantAuthnRequestsSigned="true"');
	});

	it('API-SAML-META-REQ-02: metadata advertises wantAuthnRequestsSigned=false when disabled', async () => {
		const signing = getTestSigningMaterial('http://localhost:3000');
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: false,
			signingCertPem: signing.certPem,
			signingKeyEncrypted: encrypt(signing.privateKeyPem, TEST_ENCRYPTION_KEY),
		});
		const xml = await service.generateMetadata();
		expect(xml).toContain('wantAuthnRequestsSigned="false"');
	});

	it('API-SAML-META-08: throws when IdP settings row missing', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue(null);
		await expect(service.generateMetadata()).rejects.toThrow('IdP settings not configured');
	});

	it('API-SAML-META-09: includes NameIDFormat elements', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('NameIDFormat');
		expect(xml).toContain('emailAddress');
		expect(xml).toContain('unspecified');
	});

	it('API-SAML-META-10: includes AttributeConsumingService when enabled', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('AttributeConsumingService');
		expect(xml).toContain('email');
		expect(xml).toContain('memberOf');
	});

	it('API-SAML-META-11: omits AttributeConsumingService when disabled', async () => {
		jest.mocked(configService.get).mockImplementation((key: string) => {
			if (key === 'IDP_BASE_URL') return 'http://localhost:3000';
			if (key === 'SAML_METADATA_INCLUDE_ACS') return 'false';
			return undefined;
		});
		const xml = await service.generateMetadata();
		expect(xml).not.toContain('AttributeConsumingService');
	});

	it('API-SAML-META-ENC-01: no encryption KeyDescriptor when no encryption cert', async () => {
		const xml = await service.generateMetadata();
		expect(xml).not.toContain('use="encryption"');
	});

	it('API-SAML-META-ENC-02: includes encryption KeyDescriptor when configured', async () => {
		const { generateTestRsaEncryptionCert } = await import('@test/support/crypto/test-cert.util');
		const { certPem } = generateTestRsaEncryptionCert('http://localhost:3000');
		jest.mocked(idpEncryption.getMetadataEncryptionCertificates).mockResolvedValue([certPem]);
		const xml = await service.generateMetadata();
		expect(xml).toContain('use="encryption"');
		expect(xml).toContain('X509Certificate');
	});

	it('API-SAML-META-ENC-03: signing and encryption descriptors both present', async () => {
		const { generateTestRsaEncryptionCert } = await import('@test/support/crypto/test-cert.util');
		const { certPem } = generateTestRsaEncryptionCert('http://localhost:3000');
		jest.mocked(idpEncryption.getMetadataEncryptionCertificates).mockResolvedValue([certPem]);
		const xml = await service.generateMetadata();
		expect(xml).toContain('use="signing"');
		expect(xml).toContain('use="encryption"');
	});

	it('API-SAML-META-ENC-04: signing rotation alone does not add encryption descriptors', async () => {
		const { privateKeyPem, certPem } = getTestSigningMaterial('http://localhost:3000');
		const pending = getTestSigningMaterial('https://pending-sign.example.com');
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			signingCertPem: certPem,
			signingKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			pendingSigningCertPem: pending.certPem,
			pendingSigningKeyEncrypted: encrypt(pending.privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionCertPem: null,
			pendingEncryptionCertPem: null,
		});
		jest.mocked(idpEncryption.getMetadataEncryptionCertificates).mockResolvedValue([]);
		const xml = await service.generateMetadata();
		expect((xml.match(/use="signing"/g) ?? []).length).toBe(2);
		expect(xml).not.toContain('use="encryption"');
	});

	it('API-SAML-META-ENC-05: dual signing + encryption rotation → four KeyDescriptors', async () => {
		const primarySign = getTestSigningMaterial('http://localhost:3000');
		const pendingSign = getTestSigningMaterial('https://pending-sign.example.com');
		const { generateTestRsaEncryptionCert } = await import('@test/support/crypto/test-cert.util');
		const primaryEnc = generateTestRsaEncryptionCert('http://localhost:3000');
		const pendingEnc = generateTestRsaEncryptionCert('https://pending-enc.example.com');
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			signingCertPem: primarySign.certPem,
			signingKeyEncrypted: encrypt(primarySign.privateKeyPem, TEST_ENCRYPTION_KEY),
			pendingSigningCertPem: pendingSign.certPem,
			pendingSigningKeyEncrypted: encrypt(pendingSign.privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionCertPem: primaryEnc.certPem,
			pendingEncryptionCertPem: pendingEnc.certPem,
		});
		jest
			.spyOn(idpSigning, 'getMetadataSigningCertificates')
			.mockResolvedValue([primarySign.certPem, pendingSign.certPem]);
		jest
			.spyOn(idpEncryption, 'getMetadataEncryptionCertificates')
			.mockResolvedValue([primaryEnc.certPem, pendingEnc.certPem]);
		const xml = await service.generateMetadata();
		const signingIdx = xml.indexOf('use="signing"');
		const encryptionIdx = xml.indexOf('use="encryption"');
		expect(signingIdx).toBeGreaterThanOrEqual(0);
		expect(encryptionIdx).toBeGreaterThan(signingIdx);
		expect((xml.match(/use="signing"/g) ?? []).length).toBe(2);
		expect((xml.match(/use="encryption"/g) ?? []).length).toBe(2);
	});

	it('API-SAML-META-POST-01: metadata contains HTTP-POST SingleSignOnService binding', async () => {
		const xml = await service.generateMetadata();
		expect(xml).toContain('Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"');
	});

	it('API-SAML-META-POST-02: HTTP-POST SingleSignOnService appears before HTTP-Redirect', async () => {
		const xml = await service.generateMetadata();
		const postIdx = xml.indexOf('Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"');
		const redirectIdx = xml.indexOf('Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"');
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(redirectIdx).toBeGreaterThan(postIdx);
	});

	it('API-SAML-META-POST-03: both SSO bindings point to the same SSO URL', async () => {
		const xml = await service.generateMetadata();
		// All SingleSignOnService elements should reference the same sso URL
		const matches = [...xml.matchAll(/SingleSignOnService[^/]*Location="([^"]+)"/g)];
		expect(matches.length).toBeGreaterThanOrEqual(2);
		const urls = matches.map((m) => m[1]);
		const unique = new Set(urls);
		expect(unique.size).toBe(1);
		expect(urls[0]).toContain('/saml/sso');
	});
});
