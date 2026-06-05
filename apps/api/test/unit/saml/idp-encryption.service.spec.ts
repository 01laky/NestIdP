import { PrismaService } from '@api/prisma/services/prisma.service';
import { certHasEncryptionKeyUsage } from '@api/idp-settings/utils/idp-encryption-cert.util';
import { IdpEncryptionService } from '@api/saml/services/idp-encryption.service';

describe('IdpEncryptionService', () => {
	const service = new IdpEncryptionService({} as PrismaService);

	it('API-SVC-ENC-02: generated RSA cert has encryption keyUsage, not signing-only', () => {
		const { certPem } = service.generateKeyPairAndCert('http://localhost:3000', {
			rsaModulusBits: 2048,
			notAfter: '2030-06-01',
		});
		expect(certHasEncryptionKeyUsage(certPem)).toBe(true);
		expect(certPem).toContain('BEGIN CERTIFICATE');
	});

	it('API-SVC-ENC-03: generate EC P-256 stores null transport in metadata', () => {
		const { metadata } = service.generateKeyPairAndCert('http://localhost:3000', {
			keyFamily: 'ec',
			ecCurve: 'P-256',
			notAfter: '2030-06-01',
		});
		expect(metadata.encryptionKeyFamily).toBe('ec');
		expect(metadata.encryptionKeyTransportAlgorithmId).toBeNull();
		expect(metadata.encryptionEcCurve).toBe('P-256');
	});

	it('API-SVC-ENC-04: generate with each catalog transport persists metadata id', () => {
		for (const keyTransportAlgorithmId of ['rsa-oaep-mgf1p', 'rsa-oaep', 'rsa-1_5']) {
			const { metadata } = service.generateKeyPairAndCert('http://localhost:3000', {
				keyTransportAlgorithmId,
				notAfter: '2030-07-01',
			});
			expect(metadata.encryptionKeyTransportAlgorithmId).toBe(keyTransportAlgorithmId);
		}
	});

	it('API-SVC-ENC-05: generate RSA 4096 persists modulus bits', () => {
		const { metadata } = service.generateKeyPairAndCert('http://localhost:3000', {
			rsaModulusBits: 4096,
			notAfter: '2030-08-01',
		});
		expect(metadata.encryptionRsaModulusBits).toBe(4096);
	});
});
