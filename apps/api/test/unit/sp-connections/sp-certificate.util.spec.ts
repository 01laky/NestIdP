import { assertValidSpCertificatePem, SpCertificateValidationError } from '@api/sp-connections/utils/sp-certificate.util';

const VALID_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('assertValidSpCertificatePem', () => {
	it('API-SPC-CERT-01: null and undefined return null', () => {
		expect(assertValidSpCertificatePem(null)).toBeNull();
		expect(assertValidSpCertificatePem(undefined)).toBeNull();
	});

	it('API-SPC-CERT-02: empty string returns null', () => {
		expect(assertValidSpCertificatePem('   ')).toBeNull();
	});

	it('API-SPC-CERT-03: trims valid PEM', () => {
		expect(assertValidSpCertificatePem(`  ${VALID_PEM}  `)).toBe(VALID_PEM);
	});

	it('API-SPC-CERT-04: rejects missing BEGIN marker', () => {
		expect(() => assertValidSpCertificatePem('-----END CERTIFICATE-----')).toThrow(
			SpCertificateValidationError,
		);
	});

	it('API-SPC-CERT-05: rejects oversized PEM', () => {
		const huge = `${VALID_PEM}${'x'.repeat(20_000)}`;
		expect(() => assertValidSpCertificatePem(huge)).toThrow('spCertificate is too large');
	});
});
