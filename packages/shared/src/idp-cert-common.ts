/** Shared IdP X.509 certificate validity helpers (signing + encryption). */

export type IdpCertKeyFamily = 'rsa' | 'ec';
export type IdpCertRsaModulusBits = 2048 | 3072 | 4096;
export type IdpCertEcCurve = 'P-256' | 'P-384' | 'P-521';

export const IDP_CERT_MAX_VALIDITY_YEARS = 10;
export const IDP_CERT_DEFAULT_VALIDITY_DAYS = 730;

export class IdpCertCommonValidationError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = 'IdpCertCommonValidationError';
	}
}

function utcCalendarDate(d: Date): string {
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function parseUtcCalendarDate(isoDate: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
	if (!match) {
		throw new IdpCertCommonValidationError(
			'notAfter must be YYYY-MM-DD',
			'idp_cert_invalid_not_after',
		);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const d = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
	if (Number.isNaN(d.getTime())) {
		throw new IdpCertCommonValidationError(
			'notAfter is not a valid date',
			'idp_cert_invalid_not_after',
		);
	}
	return d;
}

export function validateIdpCertNotAfter(isoDate: string, now = new Date()): string {
	const end = parseUtcCalendarDate(isoDate);
	const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
	if (endDay < todayStart) {
		throw new IdpCertCommonValidationError(
			'notAfter must not be before today (UTC)',
			'idp_cert_not_after_past',
		);
	}
	const max = new Date(now);
	max.setUTCFullYear(max.getUTCFullYear() + IDP_CERT_MAX_VALIDITY_YEARS);
	const maxDay = Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), max.getUTCDate());
	if (endDay > maxDay) {
		throw new IdpCertCommonValidationError(
			`notAfter must be within ${IDP_CERT_MAX_VALIDITY_YEARS} years (UTC)`,
			'idp_cert_not_after_too_far',
		);
	}
	return isoDate.trim();
}

export function defaultNotAfterCalendarDate(now = new Date()): string {
	const d = new Date(now);
	d.setUTCDate(d.getUTCDate() + IDP_CERT_DEFAULT_VALIDITY_DAYS);
	return utcCalendarDate(d);
}

export function notAfterCalendarDateToOpenSslEnddate(isoDate: string): string {
	const end = parseUtcCalendarDate(isoDate);
	const yy = String(end.getUTCFullYear()).slice(-2);
	const mm = String(end.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(end.getUTCDate()).padStart(2, '0');
	return `${yy}${mm}${dd}235959Z`;
}

/** Whole UTC calendar days from today (inclusive) until notAfter date — for `openssl req -days`. */
export function daysFromTodayUntilNotAfter(isoDate: string, now = new Date()): number {
	const end = parseUtcCalendarDate(isoDate);
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
	const diff = Math.round((endDay - today) / (24 * 60 * 60 * 1000));
	return Math.max(1, diff);
}

export function ecCurveToNamedCurve(curve: IdpCertEcCurve): string {
	switch (curve) {
		case 'P-256':
			return 'prime256v1';
		case 'P-384':
			return 'secp384r1';
		case 'P-521':
			return 'secp521r1';
		default:
			throw new IdpCertCommonValidationError(`Unknown EC curve: ${curve}`, 'idp_cert_bad_curve');
	}
}
