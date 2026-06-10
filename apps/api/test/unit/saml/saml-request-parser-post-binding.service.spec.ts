import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deflateRawSync } from 'node:zlib';
import {
	buildAuthnRequestXml,
	buildPlainAuthnRequestPostBody,
	buildSignedAuthnRequestPostBody,
} from '@test/support/saml/build-authn-request.util';
import { generateTestEcCert } from '@test/support/prisma/test-fixtures';
import { generateTestRsaEncryptionCert } from '@test/support/crypto/test-cert.util';
import { encryptAuthnRequestForIdp } from '@api/saml/utils/encrypt-authn-request-for-idp.util';
import { SamlRequestParserService } from '@api/saml/services/saml-request-parser.service';
import type { IdpEncryptionKeyService } from '@api/saml/services/idp-encryption-key.service';
import { generateKeyPairSync } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function generateRsaKeyAndCert(): { privateKeyPem: string; certPem: string } {
	return generateTestRsaEncryptionCert('urn:test:sp:post');
}

function generateTestSpSigningCert(): { privateKeyPem: string; certPem: string } {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-sp-sign-'));
	try {
		const keyPath = join(tmp, 'key.pem');
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(keyPath, privateKey);
		execSync(
			`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=test-sp" -nodes`,
			{ stdio: 'pipe' },
		);
		return { privateKeyPem: privateKey, certPem: readFileSync(certPath, 'utf8') };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

describe('SamlRequestParserService — POST binding (parsePostBinding)', () => {
	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'IDP_BASE_URL') return 'http://localhost:3000';
			if (key === 'SAML_CLOCK_SKEW_SECONDS') return 120;
			return undefined;
		}),
	} as unknown as ConfigService;

	const idpEncryptionKey = {
		getRsaDecryptionMaterial: jest.fn().mockResolvedValue([]),
		getEcDecryptionMaterial: jest.fn().mockResolvedValue([]),
	} as unknown as IdpEncryptionKeyService;

	const parser = new SamlRequestParserService(configService, idpEncryptionKey);

	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(idpEncryptionKey.getRsaDecryptionMaterial).mockResolvedValue([]);
		jest.mocked(idpEncryptionKey.getEcDecryptionMaterial).mockResolvedValue([]);
	});

	it('API-SAML-POST-PARSE-01: valid unsigned POST binding round-trip', async () => {
		const { samlRequestBase64, relayState } = buildPlainAuthnRequestPostBody({
			issuer: 'urn:post:sp',
			id: '_post-01',
			relayState: 'my-relay',
		});
		const result = await parser.parsePostBinding(samlRequestBase64, relayState);
		expect(result.authnRequest.id).toBe('_post-01');
		expect(result.authnRequest.issuer).toBe('urn:post:sp');
		expect(result.relayState).toBe('my-relay');
		expect(result.requestWasSigned).toBe(false);
		expect(result.requestWasEncrypted).toBe(false);
		expect(result.authnRequest.bindingType).toBe('post');
	});

	it('API-SAML-POST-PARSE-02: signed POST binding detected — requestWasSigned=true', async () => {
		const { privateKeyPem, certPem } = generateTestSpSigningCert();
		const { samlRequestBase64, relayState } = buildSignedAuthnRequestPostBody({
			issuer: 'urn:post:sp:signed',
			id: '_post-02',
			spPrivateKeyPem: privateKeyPem,
			spCertificatePem: certPem,
		});
		const result = await parser.parsePostBinding(samlRequestBase64, relayState);
		expect(result.requestWasSigned).toBe(true);
		expect(result.authnRequest.issuer).toBe('urn:post:sp:signed');
	});

	it('API-SAML-POST-PARSE-03: missing SAMLRequest → 400', async () => {
		await expect(parser.parsePostBinding('')).rejects.toThrow(BadRequestException);
		await expect(parser.parsePostBinding('  ')).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-04: non-base64 SAMLRequest → 400', async () => {
		await expect(parser.parsePostBinding('!@#$%^&*()')).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-05: missing ID → 400', async () => {
		const xml = buildAuthnRequestXml({
			id: '',
			issuer: 'urn:test',
			destination: 'http://localhost:3000/saml/sso',
		});
		const b64 = Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString(
			'base64',
		);
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-06: missing Issuer → 400', async () => {
		const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_nois" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="http://localhost:3000/saml/sso"/>`;
		const b64 = Buffer.from(xml, 'utf8').toString('base64');
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-07: IssueInstant too old → 400', async () => {
		const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const xml = buildAuthnRequestXml({
			id: '_post-old',
			issuer: 'urn:test:sp',
			destination: 'http://localhost:3000/saml/sso',
			issueInstant: old,
		});
		const b64 = Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString(
			'base64',
		);
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-08: IssueInstant in the future → 400', async () => {
		const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
		const xml = buildAuthnRequestXml({
			id: '_post-future',
			issuer: 'urn:test:sp',
			destination: 'http://localhost:3000/saml/sso',
			issueInstant: future,
		});
		const b64 = Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString(
			'base64',
		);
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-09: deflate-encoded payload rejected for POST binding → 400', async () => {
		const xml = buildAuthnRequestXml({
			id: '_post-deflate',
			issuer: 'urn:test:sp',
			destination: 'http://localhost:3000/saml/sso',
		});
		// POST binding must NOT deflate — submitting a deflated payload should be rejected
		const deflated = deflateRawSync(Buffer.from(xml, 'utf8'));
		const b64 = deflated.toString('base64');
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-10: wrong Destination → 400', async () => {
		const xml = buildAuthnRequestXml({
			id: '_post-dest',
			issuer: 'urn:test:sp',
			destination: 'https://evil.example.com/saml/sso',
		});
		const b64 = Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString(
			'base64',
		);
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-11: payload too large → 400', async () => {
		const bigXml = buildAuthnRequestXml({
			id: '_post-big',
			issuer: 'x'.repeat(300 * 1024),
			destination: 'http://localhost:3000/saml/sso',
		});
		const b64 = Buffer.from(bigXml, 'utf8').toString('base64');
		await expect(parser.parsePostBinding(b64)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-POST-PARSE-12: relayState passed through', async () => {
		const { samlRequestBase64 } = buildPlainAuthnRequestPostBody({ issuer: 'urn:rs:sp' });
		const result = await parser.parsePostBinding(samlRequestBase64, 'relay-state-value');
		expect(result.relayState).toBe('relay-state-value');
	});

	it('API-SAML-POST-PARSE-13: rawAuthnRequestXml returned in result', async () => {
		const { samlRequestBase64 } = buildPlainAuthnRequestPostBody({
			issuer: 'urn:raw:sp',
			id: '_post-raw',
		});
		const result = await parser.parsePostBinding(samlRequestBase64);
		expect(result.rawAuthnRequestXml).toContain('AuthnRequest');
		expect(result.rawAuthnRequestXml).toContain('_post-raw');
	});

	describe('POST binding with RSA-encrypted payload', () => {
		it('API-SAML-POST-PARSE-14: encrypted RSA payload decrypted when RSA key configured', async () => {
			const { privateKeyPem, certPem } = generateRsaKeyAndCert();
			jest
				.mocked(idpEncryptionKey.getRsaDecryptionMaterial)
				.mockResolvedValue([{ privateKeyPem, keyTransportAlgorithmId: 'rsa-oaep' }]);
			const xml = buildAuthnRequestXml({
				id: '_post-enc-rsa',
				issuer: 'urn:enc:sp',
				destination: 'http://localhost:3000/saml/sso',
			});
			const plainXml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const b64 = Buffer.from(encrypted, 'utf8').toString('base64');
			const result = await parser.parsePostBinding(b64);
			expect(result.requestWasEncrypted).toBe(true);
			expect(result.authnRequest.issuer).toBe('urn:enc:sp');
		});

		it('API-SAML-POST-PARSE-15: RSA-encrypted request but EC key configured → 400', async () => {
			const { certPem } = generateRsaKeyAndCert();
			jest.mocked(idpEncryptionKey.getRsaDecryptionMaterial).mockResolvedValue([]);
			jest
				.mocked(idpEncryptionKey.getEcDecryptionMaterial)
				.mockResolvedValue([{ privateKeyPem: 'fake', ecCurve: 'P-256' }]);
			const xml = buildAuthnRequestXml({
				id: '_post-enc-mismatch',
				issuer: 'urn:enc:mismatch:sp',
				destination: 'http://localhost:3000/saml/sso',
			});
			const plainXml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const b64 = Buffer.from(encrypted, 'utf8').toString('base64');
			await expect(parser.parsePostBinding(b64)).rejects.toThrow(
				expect.objectContaining({
					message: expect.stringContaining(
						'RSA key transport payload received but IdP has EC encryption key',
					),
				}),
			);
		});
	});

	describe('POST binding with EC-encrypted payload', () => {
		it('API-SAML-POST-PARSE-16: EC-encrypted payload decrypted when EC key configured', async () => {
			const { certPem, privateKeyPem } = generateTestEcCert('urn:test:ec:sp', 'P-256');
			jest
				.mocked(idpEncryptionKey.getEcDecryptionMaterial)
				.mockResolvedValue([{ privateKeyPem, ecCurve: 'P-256' }]);
			const xml = buildAuthnRequestXml({
				id: '_post-enc-ec',
				issuer: 'urn:ec:enc:sp',
				destination: 'http://localhost:3000/saml/sso',
			});
			const plainXml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const b64 = Buffer.from(encrypted, 'utf8').toString('base64');
			const result = await parser.parsePostBinding(b64);
			expect(result.requestWasEncrypted).toBe(true);
			expect(result.authnRequest.issuer).toBe('urn:ec:enc:sp');
		});

		it('API-SAML-POST-PARSE-17: EC-encrypted request but RSA key configured → 400', async () => {
			const { certPem } = generateTestEcCert('urn:test:ec:sp', 'P-256');
			jest.mocked(idpEncryptionKey.getEcDecryptionMaterial).mockResolvedValue([]);
			jest
				.mocked(idpEncryptionKey.getRsaDecryptionMaterial)
				.mockResolvedValue([{ privateKeyPem: 'fake', keyTransportAlgorithmId: 'rsa-oaep' }]);
			const xml = buildAuthnRequestXml({
				id: '_post-ec-mismatch',
				issuer: 'urn:ec:mismatch:sp',
				destination: 'http://localhost:3000/saml/sso',
			});
			const plainXml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const b64 = Buffer.from(encrypted, 'utf8').toString('base64');
			await expect(parser.parsePostBinding(b64)).rejects.toThrow(
				expect.objectContaining({
					message: expect.stringContaining(
						'EC key agreement payload received but IdP has RSA encryption key',
					),
				}),
			);
		});
	});
});
