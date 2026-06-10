import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deflateSync } from 'node:zlib';
import {
	buildAuthnRequestXml,
	encodeRedirectBinding,
} from '@test/support/saml/build-authn-request.util';
import { generateTestRsaEncryptionCert } from '@test/support/crypto/test-cert.util';
import { encryptAuthnRequestForIdp } from '@api/saml/utils/encrypt-authn-request-for-idp.util';
import { SamlRequestParserService } from '@api/saml/services/saml-request-parser.service';
import type { IdpEncryptionKeyService } from '@api/saml/services/idp-encryption-key.service';

describe('SamlRequestParserService', () => {
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

	function validEncodedRequest(options?: {
		id?: string;
		issuer?: string;
		destination?: string;
		issueInstant?: string;
		xml?: string;
	}): string {
		const xml =
			options?.xml ??
			buildAuthnRequestXml({
				id: options?.id ?? '_test-id-1',
				issuer: options?.issuer ?? 'urn:test:sp',
				destination: options?.destination ?? 'http://localhost:3000/saml/sso',
				issueInstant: options?.issueInstant,
			});
		return encodeURIComponent(encodeRedirectBinding(xml));
	}

	it('API-SAML-PARSE-01: valid minimal AuthnRequest round-trip', async () => {
		const result = await parser.parseRedirectBinding(validEncodedRequest(), 'relay-1');
		expect(result.authnRequest.id).toBe('_test-id-1');
		expect(result.authnRequest.issuer).toBe('urn:test:sp');
		expect(result.relayState).toBe('relay-1');
	});

	it('API-SAML-PARSE-02: invalid base64 → 400', async () => {
		await expect(parser.parseRedirectBinding('%%%not-valid-base64%%%')).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-03: invalid deflate payload → 400', async () => {
		const garbage = encodeURIComponent(Buffer.from('not-deflate').toString('base64'));
		await expect(parser.parseRedirectBinding(garbage)).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-04: missing ID → 400', async () => {
		const xml = buildAuthnRequestXml({
			id: '',
			issuer: 'urn:test',
			destination: 'http://localhost:3000/saml/sso',
		});
		await expect(
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-05: missing Issuer → 400', async () => {
		const xml = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_no-issuer" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="http://localhost:3000/saml/sso"/>`;
		await expect(parser.parseRedirectBinding(validEncodedRequest({ xml }))).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-06: IssueInstant too far in future → 400', async () => {
		const future = new Date(Date.now() + 10 * 60_000).toISOString();
		await expect(
			parser.parseRedirectBinding(validEncodedRequest({ issueInstant: future })),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-07: IssueInstant too far in past → 400', async () => {
		const past = new Date(Date.now() - 10 * 60_000).toISOString();
		await expect(
			parser.parseRedirectBinding(validEncodedRequest({ issueInstant: past })),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-08: empty SAMLRequest → 400', async () => {
		await expect(parser.parseRedirectBinding('')).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-09: oversized payload (> 256 KB) → 400', async () => {
		const padding = 'x'.repeat(260 * 1024);
		const xml = buildAuthnRequestXml({
			id: '_big',
			issuer: `urn:test:${padding}`,
			destination: 'http://localhost:3000/saml/sso',
		});
		await expect(
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-10: wrong root element → 400', async () => {
		const xml = `<?xml version="1.0"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_x"/>`;
		await expect(parser.parseRedirectBinding(validEncodedRequest({ xml }))).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-11: RelayState preserved in result', async () => {
		const result = await parser.parseRedirectBinding(validEncodedRequest(), 'opaque-state-99');
		expect(result.relayState).toBe('opaque-state-99');
	});

	it('API-SAML-PARSE-12: Unicode Issuer preserved', async () => {
		const issuer = 'urn:sp:café-naïve-日本';
		const result = await parser.parseRedirectBinding(validEncodedRequest({ issuer }));
		expect(result.authnRequest.issuer).toBe(issuer);
	});

	it('API-SAML-PARSE-13: Destination matches IdP SSO URL', async () => {
		const result = await parser.parseRedirectBinding(
			validEncodedRequest({ destination: 'http://localhost:3000/saml/sso/' }),
		);
		expect(result.authnRequest.destination).toBe('http://localhost:3000/saml/sso/');
	});

	it('API-SAML-PARSE-14: Destination mismatch → 400', async () => {
		await expect(
			parser.parseRedirectBinding(
				validEncodedRequest({ destination: 'http://evil.example.com/saml/sso' }),
			),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-15: malformed XML → 400', async () => {
		const xml = '<samlp:AuthnRequest><unclosed';
		await expect(
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-16: zlib-wrapped deflate still parses', async () => {
		const xml = buildAuthnRequestXml({
			id: '_zlib-id',
			issuer: 'urn:test:zlib',
			destination: 'http://localhost:3000/saml/sso',
		});
		const zlibWrapped = deflateSync(Buffer.from(xml, 'utf8'));
		const encoded = encodeURIComponent(zlibWrapped.toString('base64'));
		const result = await parser.parseRedirectBinding(encoded);
		expect(result.authnRequest.id).toBe('_zlib-id');
	});

	it('API-SAML-PARSE-17: omits Destination validation when attribute absent', async () => {
		const xml = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_no-dest" Version="2.0" IssueInstant="${new Date().toISOString()}">
  <saml:Issuer>urn:test:no-dest</saml:Issuer>
</samlp:AuthnRequest>`;
		const result = await parser.parseRedirectBinding(validEncodedRequest({ xml }));
		expect(result.authnRequest.destination).toBeUndefined();
	});

	it('API-SAML-REQ-DEC-01: encrypted request without configured key material → 400', async () => {
		const { certPem } = generateTestRsaEncryptionCert('urn:test:idp:missing-material');
		const encryptedXml = encryptAuthnRequestForIdp(plainAuthnXml('_enc-missing'), certPem);
		jest.mocked(idpEncryptionKey.getRsaDecryptionMaterial).mockResolvedValue([]);
		jest.mocked(idpEncryptionKey.getEcDecryptionMaterial).mockResolvedValue([]);

		await expect(parser.parseRedirectBinding(toEncodedRequest(encryptedXml))).rejects.toThrow(
			'IdP encryption certificate is not configured',
		);
	});

	it('API-SAML-REQ-DEC-02: RSA-encrypted request when IdP only has EC key → 400', async () => {
		const { certPem } = generateTestRsaEncryptionCert('urn:test:idp:ec-not-supported');
		const encryptedXml = encryptAuthnRequestForIdp(plainAuthnXml('_enc-ec'), certPem);
		jest.mocked(idpEncryptionKey.getRsaDecryptionMaterial).mockResolvedValue([]);
		jest
			.mocked(idpEncryptionKey.getEcDecryptionMaterial)
			.mockResolvedValue([{ privateKeyPem: 'ec-key', ecCurve: 'P-256' }]);

		await expect(parser.parseRedirectBinding(toEncodedRequest(encryptedXml))).rejects.toThrow(
			'RSA key transport payload received but IdP has EC encryption key',
		);
	});

	it('API-SAML-REQ-DEC-03: decrypts encrypted request with provided RSA decryption material', async () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('urn:test:idp:decrypt-ok');
		const encryptedXml = encryptAuthnRequestForIdp(plainAuthnXml('_enc-ok'), certPem);
		jest.mocked(idpEncryptionKey.getRsaDecryptionMaterial).mockResolvedValue([
			{
				privateKeyPem,
				keyTransportAlgorithmId: 'rsa-oaep-mgf1p',
			},
		]);

		const result = await parser.parseRedirectBinding(
			toEncodedRequest(encryptedXml),
			'relay-encrypted',
		);
		expect(result.authnRequest.id).toBe('_enc-ok');
		expect(result.requestWasEncrypted).toBe(true);
		expect(result.relayState).toBe('relay-encrypted');
	});

	function plainAuthnXml(id: string): string {
		return buildAuthnRequestXml({
			id,
			issuer: 'urn:test:sp:encrypted',
			destination: 'http://localhost:3000/saml/sso',
		});
	}

	function toEncodedRequest(xml: string): string {
		return encodeURIComponent(encodeRedirectBinding(xml));
	}
});
