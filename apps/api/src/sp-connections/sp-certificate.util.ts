export class SpCertificateValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SpCertificateValidationError';
	}
}

const MAX_PEM_LENGTH = 16_384;

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
	return trimmed;
}
