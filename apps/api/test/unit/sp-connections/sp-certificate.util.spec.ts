import {
	assertValidSpCertificatePem,
	SpCertificateValidationError,
} from '@api/sp-connections/utils/sp-certificate.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

jest.setTimeout(30_000);

describe('assertValidSpCertificatePem', () => {
	let validPem: string;

	beforeAll(() => {
		validPem = getTestSigningMaterial('urn:test:sp-cert-util').certPem.trim();
	});

	it('API-SPC-CERT-01: null and undefined return null', () => {
		expect(assertValidSpCertificatePem(null)).toBeNull();
		expect(assertValidSpCertificatePem(undefined)).toBeNull();
	});

	it('API-SPC-CERT-02: empty string returns null', () => {
		expect(assertValidSpCertificatePem('   ')).toBeNull();
	});

	it('API-SPC-CERT-03: trims valid PEM', () => {
		expect(assertValidSpCertificatePem(`  ${validPem}  `)).toBe(validPem);
	});

	it('API-SPC-CERT-04: rejects missing BEGIN marker', () => {
		expect(() => assertValidSpCertificatePem('-----END CERTIFICATE-----')).toThrow(
			SpCertificateValidationError,
		);
	});

	it('API-SPC-CERT-05: rejects oversized PEM', () => {
		const huge = `${validPem}${'x'.repeat(20_000)}`;
		expect(() => assertValidSpCertificatePem(huge)).toThrow('spCertificate is too large');
	});

	it('API-SPC-CERT-06: garbage between PEM markers is rejected (real X.509 parse, §5.C)', () => {
		const garbage = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
		expect(() => assertValidSpCertificatePem(garbage)).toThrow(SpCertificateValidationError);
		expect(() => assertValidSpCertificatePem(garbage)).toThrow(
			'spCertificate must be a valid PEM certificate',
		);
	});

	it('API-SPC-CERT-07: a parseable X.509 cert is accepted regardless of expiry concerns', () => {
		expect(assertValidSpCertificatePem(validPem)).toBe(validPem);
	});
});
