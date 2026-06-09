import { describe, expect, it } from 'vitest';
import {
	daysFromTodayUntilNotAfter,
	defaultNotAfterCalendarDate,
	ecCurveToNamedCurve,
	IDP_CERT_MAX_VALIDITY_YEARS,
	IdpCertCommonValidationError,
	notAfterCalendarDateToOpenSslEnddate,
	validateIdpCertNotAfter,
	type IdpCertEcCurve,
} from '@shared/idp-cert-common.js';

/**
 * Edge-case coverage for the shared IdP X.509 validity helpers. All take an injectable `now`, so every
 * boundary (today, max-years, leap days, format parsing, the openssl enddate encoding) is pinned
 * deterministically instead of relying on the wall clock.
 */
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

describe('validateIdpCertNotAfter', () => {
	it('SH-CERTCOMMON-01: accepts an in-range date and returns the trimmed input', () => {
		expect(validateIdpCertNotAfter('2027-06-01', at(2026, 6, 1))).toBe('2027-06-01');
		expect(validateIdpCertNotAfter('  2027-06-01  ', at(2026, 6, 1))).toBe('2027-06-01');
	});

	it('SH-CERTCOMMON-02: today (UTC) is allowed — boundary is "before today", not "today"', () => {
		expect(validateIdpCertNotAfter('2026-06-01', at(2026, 6, 1))).toBe('2026-06-01');
	});

	it('SH-CERTCOMMON-03: a date before today throws idp_cert_not_after_past', () => {
		try {
			validateIdpCertNotAfter('2026-05-31', at(2026, 6, 1));
			throw new Error('expected to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(IdpCertCommonValidationError);
			expect((err as IdpCertCommonValidationError).code).toBe('idp_cert_not_after_past');
		}
	});

	it('SH-CERTCOMMON-04: exactly MAX_VALIDITY_YEARS out is allowed; one day past throws too_far', () => {
		const now = at(2026, 6, 1);
		const maxDate = `${2026 + IDP_CERT_MAX_VALIDITY_YEARS}-06-01`;
		expect(validateIdpCertNotAfter(maxDate, now)).toBe(maxDate);
		const tooFar = `${2026 + IDP_CERT_MAX_VALIDITY_YEARS}-06-02`;
		expect(() => validateIdpCertNotAfter(tooFar, now)).toThrow(IdpCertCommonValidationError);
		try {
			validateIdpCertNotAfter(tooFar, now);
		} catch (err) {
			expect((err as IdpCertCommonValidationError).code).toBe('idp_cert_not_after_too_far');
		}
	});

	it('SH-CERTCOMMON-05: malformed formats are rejected with idp_cert_invalid_not_after', () => {
		const now = at(2026, 6, 1);
		for (const bad of ['2026-6-1', '2026/06/01', '20260601', 'garbage', '', '2026-06']) {
			try {
				validateIdpCertNotAfter(bad, now);
				throw new Error(`expected ${bad} to throw`);
			} catch (err) {
				expect(err).toBeInstanceOf(IdpCertCommonValidationError);
				expect((err as IdpCertCommonValidationError).code).toBe('idp_cert_invalid_not_after');
			}
		}
	});

	it('SH-CERTCOMMON-06: documented quirk — JS Date normalises overflow (month 13 / Feb 30), so they are NOT format-rejected', () => {
		// `2026-13-01` parses (regex matches \d{2}) and Date.UTC rolls it into 2027-01-01.
		expect(validateIdpCertNotAfter('2026-13-01', at(2026, 6, 1))).toBe('2026-13-01');
		// `2026-02-30` rolls to 2026-03-02 — still a valid (non-NaN) time, so accepted.
		expect(validateIdpCertNotAfter('2026-02-30', at(2026, 1, 1))).toBe('2026-02-30');
	});

	it('SH-CERTCOMMON-07: leap-day max boundary normalises forward (2024-02-29 + 10y → 2034-03-01)', () => {
		const now = at(2024, 2, 29);
		// 2034 is not a leap year, so the +10y max rolls to 2034-03-01; that exact date is allowed.
		expect(validateIdpCertNotAfter('2034-03-01', now)).toBe('2034-03-01');
		expect(() => validateIdpCertNotAfter('2034-03-02', now)).toThrow(IdpCertCommonValidationError);
	});
});

describe('defaultNotAfterCalendarDate', () => {
	it('SH-CERTCOMMON-08: returns a YYYY-MM-DD date 730 days out that validates in-range', () => {
		const now = at(2026, 1, 1);
		const result = defaultNotAfterCalendarDate(now);
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const expected = new Date(now);
		expected.setUTCDate(expected.getUTCDate() + 730);
		const y = expected.getUTCFullYear();
		const m = String(expected.getUTCMonth() + 1).padStart(2, '0');
		const d = String(expected.getUTCDate()).padStart(2, '0');
		expect(result).toBe(`${y}-${m}-${d}`);
		// And the default must itself pass validation against the same clock.
		expect(validateIdpCertNotAfter(result, now)).toBe(result);
	});
});

describe('notAfterCalendarDateToOpenSslEnddate', () => {
	it('SH-CERTCOMMON-09: encodes YYMMDD235959Z', () => {
		expect(notAfterCalendarDateToOpenSslEnddate('2027-12-31')).toBe('271231235959Z');
		expect(notAfterCalendarDateToOpenSslEnddate('2030-01-05')).toBe('300105235959Z');
	});

	it('SH-CERTCOMMON-10: two-digit year wraps at the century (2000→00, 2099→99)', () => {
		expect(notAfterCalendarDateToOpenSslEnddate('2000-06-15')).toBe('000615235959Z');
		expect(notAfterCalendarDateToOpenSslEnddate('2099-11-09')).toBe('991109235959Z');
	});

	it('SH-CERTCOMMON-11: malformed dates throw the shared validation error', () => {
		expect(() => notAfterCalendarDateToOpenSslEnddate('not-a-date')).toThrow(
			IdpCertCommonValidationError,
		);
	});
});

describe('daysFromTodayUntilNotAfter', () => {
	it('SH-CERTCOMMON-12: whole-day differences are exact', () => {
		expect(daysFromTodayUntilNotAfter('2026-06-08', at(2026, 6, 1))).toBe(7);
		expect(daysFromTodayUntilNotAfter('2028-06-01', at(2026, 6, 1))).toBe(731); // 2027 not leap, 2028 leap
	});

	it('SH-CERTCOMMON-13: same-day, tomorrow and past dates all floor to at least 1', () => {
		expect(daysFromTodayUntilNotAfter('2026-06-01', at(2026, 6, 1))).toBe(1); // today → clamped to 1
		expect(daysFromTodayUntilNotAfter('2026-06-02', at(2026, 6, 1))).toBe(1);
		expect(daysFromTodayUntilNotAfter('2020-01-01', at(2026, 6, 1))).toBe(1); // past → clamped to 1
	});

	it('SH-CERTCOMMON-14: the intra-day time of `now` does not shift the whole-day count', () => {
		const early = new Date(Date.UTC(2026, 5, 1, 0, 0, 1));
		const late = new Date(Date.UTC(2026, 5, 1, 23, 59, 59));
		expect(daysFromTodayUntilNotAfter('2026-06-10', early)).toBe(9);
		expect(daysFromTodayUntilNotAfter('2026-06-10', late)).toBe(9);
	});
});

describe('ecCurveToNamedCurve', () => {
	it('SH-CERTCOMMON-15: maps each supported curve to its OpenSSL name', () => {
		expect(ecCurveToNamedCurve('P-256')).toBe('prime256v1');
		expect(ecCurveToNamedCurve('P-384')).toBe('secp384r1');
		expect(ecCurveToNamedCurve('P-521')).toBe('secp521r1');
	});

	it('SH-CERTCOMMON-16: an unknown curve throws idp_cert_bad_curve', () => {
		try {
			ecCurveToNamedCurve('P-999' as IdpCertEcCurve);
			throw new Error('expected to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(IdpCertCommonValidationError);
			expect((err as IdpCertCommonValidationError).code).toBe('idp_cert_bad_curve');
		}
	});
});
