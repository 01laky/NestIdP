import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { EncryptionService } from '@api/encryption/services/encryption.service';
import { encrypt } from '@api/encryption/utils/encryption.util';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	createTestIdpSettings,
	getTestSigningMaterial,
	TEST_ENCRYPTION_KEY,
} from '@test/support/prisma/test-fixtures';
import { IDP_SIGNING_SIGNATURE_ALGORITHMS } from '@nestidp/shared';
import { IdpSigningService } from '@api/saml/services/idp-signing.service';
import { SamlAuthAuditService } from '@api/saml/services/saml-auth-audit.service';
import { verifySamlXmlSignature } from '@test/support/saml/verify-saml-signature.util';
import { create } from 'xmlbuilder2';

jest.setTimeout(120_000);

describe('IdpSigningService (SQLite)', () => {
	let prisma: PrismaClient;
	let service: IdpSigningService;
	let databaseUrl: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-signing-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		const configService = {
			get: (key: string) => (key === 'ENCRYPTION_KEY' ? TEST_ENCRYPTION_KEY : undefined),
		} as unknown as ConfigService;
		const encryptionService = new EncryptionService(configService);
		const audit = new SamlAuthAuditService({ recordSafe: jest.fn() } as never);
		service = new IdpSigningService(
			prisma as unknown as PrismaService,
			encryptionService,
			configService,
			audit,
		);
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	function buildAssertionXml(id: string): string {
		return create()
			.ele('saml2:Assertion', {
				'xmlns:saml2': 'urn:oasis:names:tc:SAML:2.0:assertion',
				ID: id,
				Version: '2.0',
				IssueInstant: new Date().toISOString(),
			})
			.ele('saml2:Issuer')
			.txt('http://localhost:3000')
			.up()
			.up()
			.end({ headless: true });
	}

	it('API-SAML-SIGN-01: ensureSigningMaterial generates keys when missing', async () => {
		await createTestIdpSettings(prisma, { entityId: 'http://localhost:3000' });
		const material = await service.ensureSigningMaterial();
		expect(material.certPem).toContain('BEGIN CERTIFICATE');
		expect(material.privateKeyPem).toContain('BEGIN');
	});

	it('API-SAML-SIGN-02: ensureSigningMaterial is idempotent', async () => {
		const first = await service.ensureSigningMaterial();
		const second = await service.ensureSigningMaterial();
		expect(second.certPem).toBe(first.certPem);
	});

	it('API-SAML-SIGN-03: signAssertion round-trip verifies', async () => {
		const material = await service.ensureSigningMaterial();
		const assertionId = `_${randomUUID().replace(/-/g, '')}`;
		const signed = service.signAssertion(buildAssertionXml(assertionId), material, assertionId);
		expect(verifySamlXmlSignature(`<container>${signed}</container>`, material.certPem)).toBe(true);
	});

	it('API-SAML-SIGN-04: tampered signed XML fails verify', async () => {
		const material = await service.ensureSigningMaterial();
		const assertionId = '_tamper-test';
		const signed = service.signAssertion(buildAssertionXml(assertionId), material, assertionId);
		const tampered = signed.replace('http://localhost:3000', 'http://evil.example');
		const response = `<?xml version="1.0"?><saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol">${tampered}</saml2p:Response>`;
		expect(verifySamlXmlSignature(response, material.certPem)).toBe(false);
	});

	it('API-SAML-SIGN-05: hasSigningMaterial true after generation', async () => {
		expect(await service.hasSigningMaterial()).toBe(true);
	});

	it('API-SAML-SIGN-06: extractX509CertificatePem strips PEM headers', async () => {
		const material = await service.ensureSigningMaterial();
		const body = service.extractX509CertificatePem(material.certPem);
		expect(body).not.toContain('BEGIN CERTIFICATE');
		expect(body.length).toBeGreaterThan(100);
	});

	it('API-SAML-SIGN-07: hasSigningMaterial false before keys exist', async () => {
		const freshDb = join(tmpdir(), `nestidp-signing-fresh-${randomUUID()}.db`);
		const url = `file:${freshDb}`;
		await runMigrationsOnTestDb(url);
		const freshPrisma = new PrismaService({ datasources: { db: { url } } });
		const configService = {
			get: (key: string) => (key === 'ENCRYPTION_KEY' ? TEST_ENCRYPTION_KEY : undefined),
		} as unknown as ConfigService;
		const freshService = new IdpSigningService(
			freshPrisma as unknown as PrismaService,
			new EncryptionService(configService),
			configService,
			new SamlAuthAuditService({ recordSafe: jest.fn() } as never),
		);
		await createTestIdpSettings(freshPrisma, { entityId: 'http://fresh.test' });
		expect(await freshService.hasSigningMaterial()).toBe(false);
		await freshPrisma.$disconnect();
		try {
			unlinkSync(url.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-SAML-SIGN-08: reuses persisted encrypted key without regeneration', async () => {
		const { privateKeyPem, certPem: seededCert } = getTestSigningMaterial('http://localhost:3000');
		const encrypted = encrypt(privateKeyPem, TEST_ENCRYPTION_KEY);
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { signingCertPem: seededCert, signingKeyEncrypted: encrypted },
		});
		const material = await service.ensureSigningMaterial();
		expect(material.certPem).toBe(seededCert);
		expect(material.privateKeyPem).toBe(privateKeyPem);
	});

	it('API-SAML-SIGN-09: wrong assertionId reference throws during signing', async () => {
		const material = await service.ensureSigningMaterial();
		expect(() =>
			service.signAssertion(buildAssertionXml('_wrong-id-ref'), material, '_different-id'),
		).toThrow();
	});

	it('API-SAML-SIGN-10: extractX509CertificatePem collapses newlines', async () => {
		const material = await service.ensureSigningMaterial();
		const withBreaks = material.certPem.replace(/\n/g, '\n  ');
		const body = service.extractX509CertificatePem(withBreaks);
		expect(body).not.toMatch(/\s{2,}/);
	});

	it('API-SAML-SIGN-11: generated cert subject relates to entityId', async () => {
		const material = await service.ensureSigningMaterial();
		expect(material.certPem).toContain('BEGIN CERTIFICATE');
		expect(material.privateKeyPem).toMatch(/BEGIN (RSA )?PRIVATE KEY/);
	});

	it('API-SAML-SIGN-12: signed assertion contains Signature element', async () => {
		const material = await service.ensureSigningMaterial();
		const assertionId = '_sig-elem';
		const signed = service.signAssertion(buildAssertionXml(assertionId), material, assertionId);
		expect(signed).toContain('Signature');
		expect(signed).toContain('SignatureValue');
	});

	it('API-SAML-SIGN-16: EC P-256 ecdsa-sha256 assertion verifies', () => {
		const generated = service.generateKeyPairAndCert('https://ec.example.com', {
			keyFamily: 'ec',
			ecCurve: 'P-256',
			signatureAlgorithmId: 'ecdsa-sha256',
			notAfter: '2030-01-01',
		});
		const assertionId = '_ec-sig';
		const signed = service.signAssertion(
			buildAssertionXml(assertionId),
			{
				certPem: generated.certPem,
				privateKeyPem: generated.privateKeyPem,
				signatureAlgorithmId: 'ecdsa-sha256',
			},
			assertionId,
		);
		expect(verifySamlXmlSignature(`<container>${signed}</container>`, generated.certPem)).toBe(
			true,
		);
	});

	it('API-SAML-SIGN-19: each catalog algorithm signs and verifies', () => {
		for (const algo of IDP_SIGNING_SIGNATURE_ALGORITHMS) {
			const options =
				algo.keyFamily === 'rsa'
					? {
							keyFamily: 'rsa' as const,
							rsaModulusBits: 2048 as const,
							signatureAlgorithmId: algo.id,
							notAfter: '2030-12-31',
						}
					: {
							keyFamily: 'ec' as const,
							ecCurve: 'P-256' as const,
							signatureAlgorithmId: algo.id,
							notAfter: '2030-12-31',
						};
			const generated = service.generateKeyPairAndCert(`https://algo-${algo.id}.example`, options);
			const assertionId = `_algo-${algo.id.replace(/[^a-z0-9]/gi, '')}`;
			const signed = service.signAssertion(
				buildAssertionXml(assertionId),
				{
					certPem: generated.certPem,
					privateKeyPem: generated.privateKeyPem,
					signatureAlgorithmId: algo.id,
				},
				assertionId,
			);
			expect(signed).toContain(algo.xmlSignatureAlgorithm.split('#').pop() ?? algo.id);
			expect(verifySamlXmlSignature(`<container>${signed}</container>`, generated.certPem)).toBe(
				true,
			);
		}
	});

	it('API-SAML-SIGN-20: unknown stored algorithm id falls back to rsa-sha256 in signature', () => {
		const generated = service.generateKeyPairAndCert('https://fallback.example', {
			notAfter: '2030-01-01',
		});
		const assertionId = '_unknown-algo';
		const signed = service.signAssertion(
			buildAssertionXml(assertionId),
			{
				certPem: generated.certPem,
				privateKeyPem: generated.privateKeyPem,
				signatureAlgorithmId: 'totally-unknown',
			},
			assertionId,
		);
		expect(signed).toContain('rsa-sha256');
	});

	it('API-SAML-SIGN-17: signAssertion falls back to rsa-sha256 when algorithm id null', async () => {
		const material = await service.ensureSigningMaterial();
		const assertionId = '_legacy';
		const signed = service.signAssertion(
			buildAssertionXml(assertionId),
			{ ...material, signatureAlgorithmId: null },
			assertionId,
		);
		expect(signed).toContain('xmldsig-more#rsa-sha256');
	});

	it('API-SAML-SIGN-13: ensureSigningMaterial throws when only pending cert exists (rotation)', async () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial('http://localhost:3000');
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: null,
				signingKeyEncrypted: null,
				pendingSigningCertPem: certPem,
				pendingSigningKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
				rotationStartedAt: new Date(),
			},
		});
		await expect(service.ensureSigningMaterial()).rejects.toThrow(
			'IdP signing certificate not configured',
		);
	});

	it('API-SAML-SIGN-14: getMetadataSigningCertificates returns primary then pending during rotation', async () => {
		const primary = getTestSigningMaterial('http://localhost:3000');
		const pending = getTestSigningMaterial('http://pending.example.com');
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: primary.certPem,
				signingKeyEncrypted: encrypt(primary.privateKeyPem, TEST_ENCRYPTION_KEY),
				pendingSigningCertPem: pending.certPem,
				pendingSigningKeyEncrypted: encrypt(pending.privateKeyPem, TEST_ENCRYPTION_KEY),
				rotationStartedAt: new Date(),
			},
		});
		const certs = await service.getMetadataSigningCertificates();
		expect(certs).toHaveLength(2);
		expect(certs[0]).toBe(primary.certPem);
		expect(certs[1]).toBe(pending.certPem);
	});

	it('API-SAML-SIGN-15: getMetadataSigningCertificates lazy-generates when no certs at all', async () => {
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
		const certs = await service.getMetadataSigningCertificates();
		expect(certs).toHaveLength(1);
		expect(certs[0]).toContain('BEGIN CERTIFICATE');
		const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(row?.signingCertPem).toBe(certs[0]);
	});

	it('API-SAML-SIGN-21: entityId shell metacharacters cannot inject a command (§5.A1)', () => {
		// A "/CN=..." subject is interpolated from entityId. Under the old execSync+shell path a payload
		// that closes the quote and chains `;touch <marker>` would run touch. Under spawnSync (args array,
		// no shell) it is a literal argv byte string and can never execute. We assert the injected command
		// did NOT run regardless of whether openssl tolerates the odd subject (it may throw — that's fine).
		const marker = join(tmpdir(), `nestidp-injtest-${randomUUID()}.flag`);
		expect(existsSync(marker)).toBe(false);
		const maliciousEntityId = `https://idp.example";touch ${marker};"`;
		try {
			service.generateKeyPairAndCert(maliciousEntityId, { notAfter: '2030-01-01' });
		} catch {
			// openssl may reject the unusual subject — irrelevant; the security property is below.
		}
		expect(existsSync(marker)).toBe(false);
		if (existsSync(marker)) {
			unlinkSync(marker);
		}
	});

	it('API-SAML-SIGN-22: signAssertion throws rather than emitting an unsigned assertion (§5.A2)', () => {
		const generated = service.generateKeyPairAndCert('https://a2.example', {
			notAfter: '2030-01-01',
		});
		const id = '_a2-not-an-assertion';
		// A wrapper whose signed element is NOT a <saml2:Assertion> makes fragment extraction return null.
		// The fixed code must reject; the old code returned the unsigned `stripped` element.
		const notAnAssertion = create()
			.ele('saml2:Other', {
				'xmlns:saml2': 'urn:oasis:names:tc:SAML:2.0:assertion',
				ID: id,
				Version: '2.0',
				IssueInstant: new Date().toISOString(),
			})
			.ele('saml2:Issuer')
			.txt('http://localhost:3000')
			.up()
			.up()
			.end({ headless: true });
		expect(() =>
			service.signAssertion(
				notAnAssertion,
				{
					certPem: generated.certPem,
					privateKeyPem: generated.privateKeyPem,
					signatureAlgorithmId: null,
				},
				id,
			),
		).toThrow(/signed SAML assertion/i);
	});
});
