import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptAuthnRequestForIdp } from '@api/saml/utils/encrypt-authn-request-for-idp.util';
import {
	decryptXmlEcdhEs,
	isEcdhEsAgreement,
} from '@api/saml/utils/saml-xml-decryption.util';
import {
	deriveEcdhEsKeyWithConcatKdf,
	extractEcPublicKeyFromXenc11,
} from '@api/saml/utils/saml-xml-encryption-shared.util';
import { buildAuthnRequestXml } from '@test/support/saml/build-authn-request.util';

function generateTestEcCert(
	curve: 'P-256' | 'P-384' | 'P-521',
): { certPem: string; privateKeyPem: string } {
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-ec-test-'));
	const keyPath = join(tmp, 'key.pem');
	const certPath = join(tmp, 'cert.pem');
	const curveName = curve === 'P-256' ? 'prime256v1' : curve === 'P-384' ? 'secp384r1' : 'secp521r1';
	try {
		execSync(
			`openssl ecparam -name ${curveName} -genkey -noout -out "${keyPath}" 2>/dev/null && ` +
				`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=test" -nodes 2>/dev/null`,
			{ stdio: 'pipe' },
		);
		const privateKeyPem = readFileSync(keyPath, 'utf8');
		const certPem = readFileSync(certPath, 'utf8');
		return { certPem, privateKeyPem };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const plainXml = buildAuthnRequestXml({
	id: '_ec-dec-test',
	issuer: 'urn:test:ec:sp',
	destination: 'http://localhost:3000/saml/sso',
});

describe('saml-xml-ec-decryption.util', () => {
	describe('isEcdhEsAgreement', () => {
		it('returns false for RSA-encrypted payload', () => {
			const xml = `<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>
  <ds:KeyInfo>
    <xenc:EncryptedKey>
      <xenc:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#rsa-oaep-mgf1p"/>
      <xenc:CipherData><xenc:CipherValue>abc</xenc:CipherValue></xenc:CipherData>
    </xenc:EncryptedKey>
  </ds:KeyInfo>
  <xenc:CipherData><xenc:CipherValue>xyz</xenc:CipherValue></xenc:CipherData>
</xenc:EncryptedData>`;
			expect(isEcdhEsAgreement(xml)).toBe(false);
		});

		it('returns true for ECDH-ES AgreementMethod payload', () => {
			const xml = `<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" xmlns:xenc11="http://www.w3.org/2009/xmlenc11#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>
  <ds:KeyInfo>
    <xenc11:AgreementMethod Algorithm="http://www.w3.org/2009/xmlenc11#ECDH-ES"/>
  </ds:KeyInfo>
  <xenc:CipherData><xenc:CipherValue>xyz</xenc:CipherValue></xenc:CipherData>
</xenc:EncryptedData>`;
			expect(isEcdhEsAgreement(xml)).toBe(true);
		});

		it('returns false for malformed XML', () => {
			expect(isEcdhEsAgreement('<not valid xml')).toBe(false);
			expect(isEcdhEsAgreement('')).toBe(false);
		});
	});

	describe('decryptXmlEcdhEs — P-256', () => {
		let certPem: string;
		let privateKeyPem: string;

		beforeAll(() => {
			({ certPem, privateKeyPem } = generateTestEcCert('P-256'));
		});

		it('API-SAML-EC-DEC-UTIL-01: round-trip P-256 aes256-cbc', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			expect(isEcdhEsAgreement(encrypted)).toBe(true);
			const decrypted = decryptXmlEcdhEs(encrypted, privateKeyPem, 'P-256');
			expect(decrypted).toContain('AuthnRequest');
			expect(decrypted).toContain('urn:test:ec:sp');
		});

		it('API-SAML-EC-DEC-UTIL-04: aes128-cbc content encryption with EC key', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem, {
				contentEncryptionAlgorithmId: 'aes128-cbc',
			});
			expect(isEcdhEsAgreement(encrypted)).toBe(true);
			const decrypted = decryptXmlEcdhEs(encrypted, privateKeyPem, 'P-256');
			expect(decrypted).toContain('AuthnRequest');
		});

		it('API-SAML-EC-DEC-UTIL-05: curve mismatch throws ec_curve_mismatch', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			expect(() => decryptXmlEcdhEs(encrypted, privateKeyPem, 'P-384')).toThrow(
				expect.objectContaining({ code: 'ec_curve_mismatch' }),
			);
		});

		it('API-SAML-EC-DEC-UTIL-06: invalid EC point throws ec_point_invalid', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			// Corrupt the PublicKey element to have an invalid base64 point
			const corrupted = encrypted.replace(
				/<xenc11:PublicKey>[^<]+<\/xenc11:PublicKey>/,
				'<xenc11:PublicKey>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</xenc11:PublicKey>',
			);
			expect(() => decryptXmlEcdhEs(corrupted, privateKeyPem, 'P-256')).toThrow(
				expect.objectContaining({ code: 'ec_point_invalid' }),
			);
		});

		it('API-SAML-EC-DEC-UTIL-07: unknown AgreementMethod URI throws ec_agreement_method_not_supported', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const corrupted = encrypted.replace(
				'Algorithm="http://www.w3.org/2009/xmlenc11#ECDH-ES"',
				'Algorithm="http://example.com/unknown-agreement"',
			);
			expect(() => decryptXmlEcdhEs(corrupted, privateKeyPem, 'P-256')).toThrow(
				expect.objectContaining({ code: 'ec_agreement_method_not_supported' }),
			);
		});

		it('API-SAML-EC-DEC-UTIL-09: AES-256-GCM content algorithm URI throws encrypted_request_unsupported_algorithm', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const corrupted = encrypted.replace(
				'Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"',
				'Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"',
			);
			expect(() => decryptXmlEcdhEs(corrupted, privateKeyPem, 'P-256')).toThrow(
				expect.objectContaining({ code: 'encrypted_request_unsupported_algorithm' }),
			);
		});

		it('API-SAML-EC-DEC-UTIL-10: completely unknown content algorithm URI throws encrypted_request_unsupported_algorithm', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			const corrupted = encrypted.replace(
				'Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"',
				'Algorithm="http://example.com/totally-unknown-cipher"',
			);
			expect(() => decryptXmlEcdhEs(corrupted, privateKeyPem, 'P-256')).toThrow(
				expect.objectContaining({ code: 'encrypted_request_unsupported_algorithm' }),
			);
		});
	});

	describe('decryptXmlEcdhEs — P-384', () => {
		let certPem: string;
		let privateKeyPem: string;

		beforeAll(() => {
			({ certPem, privateKeyPem } = generateTestEcCert('P-384'));
		});

		it('API-SAML-EC-DEC-UTIL-02: round-trip P-384 aes256-cbc', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			expect(isEcdhEsAgreement(encrypted)).toBe(true);
			const decrypted = decryptXmlEcdhEs(encrypted, privateKeyPem, 'P-384');
			expect(decrypted).toContain('AuthnRequest');
			expect(decrypted).toContain('urn:test:ec:sp');
		});
	});

	describe('decryptXmlEcdhEs — P-521', () => {
		let certPem: string;
		let privateKeyPem: string;

		beforeAll(() => {
			({ certPem, privateKeyPem } = generateTestEcCert('P-521'));
		});

		it('API-SAML-EC-DEC-UTIL-03: round-trip P-521 aes256-cbc', () => {
			const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
			expect(isEcdhEsAgreement(encrypted)).toBe(true);
			const decrypted = decryptXmlEcdhEs(encrypted, privateKeyPem, 'P-521');
			expect(decrypted).toContain('AuthnRequest');
			expect(decrypted).toContain('urn:test:ec:sp');
		});
	});

	describe('deriveEcdhEsKeyWithConcatKdf', () => {
		it('API-SAML-EC-DEC-UTIL-08: deterministic SHA-256 derivation for known inputs', () => {
			const sharedSecret = Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef', 'hex');
			const algorithmId256 = Buffer.from('\x00\x00\x00\x07AES-256', 'binary');
			const algorithmId128 = Buffer.from('\x00\x00\x00\x07AES-128', 'binary');

			const key256 = deriveEcdhEsKeyWithConcatKdf({ sharedSecret, algorithmId: algorithmId256, keyLengthBits: 256 });
			const key128 = deriveEcdhEsKeyWithConcatKdf({ sharedSecret, algorithmId: algorithmId128, keyLengthBits: 128 });

			expect(key256).toHaveLength(32);
			expect(key128).toHaveLength(16);

			// Must be deterministic
			const key256b = deriveEcdhEsKeyWithConcatKdf({ sharedSecret, algorithmId: algorithmId256, keyLengthBits: 256 });
			expect(key256.equals(key256b)).toBe(true);

			// Same algorithmId but different keyLengthBits → different keys (keyDataLen is part of hash input)
			const key256AsKey128 = deriveEcdhEsKeyWithConcatKdf({ sharedSecret, algorithmId: algorithmId256, keyLengthBits: 128 });
			expect(key256AsKey128).toHaveLength(16);
			// keyDataLen (128 vs 256) is part of OtherInfo, so derived keys must differ
			expect(key256.subarray(0, 16).equals(key256AsKey128)).toBe(false);
		});

		it('empty partyUInfo and partyVInfo are handled', () => {
			const sharedSecret = Buffer.from('cafebabe'.repeat(4), 'hex');
			const algorithmId = Buffer.alloc(0);
			const key = deriveEcdhEsKeyWithConcatKdf({ sharedSecret, algorithmId, keyLengthBits: 128 });
			expect(key).toHaveLength(16);
		});
	});

	describe('extractEcPublicKeyFromXenc11', () => {
		it('rejects non-uncompressed point', () => {
			expect(() =>
				extractEcPublicKeyFromXenc11('1.2.840.10045.3.1.7', Buffer.alloc(65, 0x02).toString('base64')),
			).toThrow();
		});

		it('rejects wrong point size for P-256', () => {
			// P-256 point must be 65 bytes (0x04 + 32 + 32)
			const point = Buffer.alloc(97, 0x04); // wrong size (P-384 size)
			expect(() =>
				extractEcPublicKeyFromXenc11('1.2.840.10045.3.1.7', point.toString('base64')),
			).toThrow();
		});
	});
});
