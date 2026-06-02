import { createHash, createSign, createVerify, X509Certificate } from 'node:crypto';

export class IdpCertValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdpCertValidationError';
	}
}

const MAX_PEM_LENGTH = 16_384;

export function assertValidSigningCertPem(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpCertValidationError('signingCertPem is required');
	}
	if (trimmed.length > MAX_PEM_LENGTH) {
		throw new IdpCertValidationError('signingCertPem is too large');
	}
	if (!trimmed.includes('BEGIN CERTIFICATE') || !trimmed.includes('END CERTIFICATE')) {
		throw new IdpCertValidationError('signingCertPem must be a valid PEM certificate');
	}
	return trimmed;
}

export function assertValidSigningPrivateKeyPem(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpCertValidationError('signingPrivateKeyPem is required');
	}
	if (trimmed.length > MAX_PEM_LENGTH) {
		throw new IdpCertValidationError('signingPrivateKeyPem is too large');
	}
	if (!trimmed.includes('BEGIN') || !trimmed.includes('PRIVATE KEY')) {
		throw new IdpCertValidationError('signingPrivateKeyPem must be a valid PEM private key');
	}
	return trimmed;
}

export function assertMatchingKeyPair(certPem: string, privateKeyPem: string): void {
	const payload = 'nestidp-keypair-check';
	try {
		const signer = createSign('RSA-SHA256');
		signer.update(payload);
		signer.end();
		const signature = signer.sign(privateKeyPem);
		const verifier = createVerify('RSA-SHA256');
		verifier.update(payload);
		verifier.end();
		if (verifier.verify(certPem, signature)) {
			return;
		}
	} catch {
		// fall through to mismatch error
	}
	throw new IdpCertValidationError('Certificate and private key do not match');
}

export function fingerprintSha256Hex(certPem: string): string {
	const cert = new X509Certificate(certPem);
	return createHash('sha256').update(cert.raw).digest('hex');
}

export function parseCertNotAfterIso(certPem: string | null | undefined): string | null {
	if (!certPem) {
		return null;
	}
	try {
		const cert = new X509Certificate(certPem);
		return new Date(cert.validTo).toISOString();
	} catch {
		return null;
	}
}

export function isCertExpiringSoon(notAfterIso: string | null, warningDays: number): boolean {
	if (!notAfterIso) {
		return false;
	}
	const notAfter = new Date(notAfterIso).getTime();
	if (Number.isNaN(notAfter)) {
		return false;
	}
	const threshold = Date.now() + warningDays * 24 * 60 * 60 * 1000;
	return notAfter <= threshold;
}

export function validateSigningCertPair(
	certPem: string,
	privateKeyPem: string,
): {
	certPem: string;
	privateKeyPem: string;
} {
	const normalizedCert = assertValidSigningCertPem(certPem);
	const normalizedKey = assertValidSigningPrivateKeyPem(privateKeyPem);
	assertMatchingKeyPair(normalizedCert, normalizedKey);
	return { certPem: normalizedCert, privateKeyPem: normalizedKey };
}
