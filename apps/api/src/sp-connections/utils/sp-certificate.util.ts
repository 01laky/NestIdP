import { X509Certificate } from 'node:crypto';
import { MAX_PEM_LENGTH } from '../../common/constants/crypto-limits';

export class SpCertificateValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SpCertificateValidationError';
	}
}

export function assertValidSpCertificatePem(value: string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (trimmed.length > MAX_PEM_LENGTH) {
		throw new SpCertificateValidationError('spCertificate is too large');
	}
	if (!trimmed.includes('BEGIN CERTIFICATE') || !trimmed.includes('END CERTIFICATE')) {
		throw new SpCertificateValidationError('spCertificate must be a valid PEM certificate');
	}
	// §5.C: parse for real (same approach as the §B8 idp-cert fix) — a substring check happily stored
	// garbage that only blew up later at SSO time. Expiry is deliberately NOT checked: a stale-but-parseable
	// SP cert is the SP's problem and must stay loadable.
	try {
		new X509Certificate(trimmed);
	} catch {
		throw new SpCertificateValidationError('spCertificate must be a valid PEM certificate');
	}
	return trimmed;
}
