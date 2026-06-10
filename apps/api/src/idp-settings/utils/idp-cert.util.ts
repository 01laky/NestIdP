import {
	createHash,
	createPrivateKey,
	createSign,
	createVerify,
	X509Certificate,
	type KeyObject,
} from 'node:crypto';
import type { IdpSigningEcCurve, IdpSigningKeyFamily, StoredSigningCrypto } from '@nestidp/shared';
import {
	defaultSignatureAlgorithmIdForKeyFamily,
	getIdpSigningSignatureOption,
	MS_PER_DAY,
} from '@nestidp/shared';
import { MAX_PEM_LENGTH } from '../../common/constants/crypto-limits';

export class IdpCertValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdpCertValidationError';
	}
}

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

export function detectKeyFamily(keyObject: KeyObject): IdpSigningKeyFamily {
	const type = keyObject.asymmetricKeyType;
	if (type === 'rsa') {
		return 'rsa';
	}
	if (type === 'ec') {
		return 'ec';
	}
	throw new IdpCertValidationError('Private key must be RSA or EC');
}

function detectRsaModulusBits(keyObject: KeyObject): number {
	const length = keyObject.asymmetricKeyDetails?.modulusLength;
	if (!length) {
		// Don't silently store 2048 for a key whose size we can't read — it would mislabel the metadata.
		throw new IdpCertValidationError('Unable to determine the RSA modulus size from the key');
	}
	return length;
}

export function namedCurveToLabel(namedCurve: string | undefined): IdpSigningEcCurve {
	switch (namedCurve) {
		case 'prime256v1':
			return 'P-256';
		case 'secp384r1':
			return 'P-384';
		case 'secp521r1':
			return 'P-521';
		default:
			// Reject unknown curves instead of mislabelling them as P-256.
			throw new IdpCertValidationError(
				`Unsupported EC curve${namedCurve ? ` '${namedCurve}'` : ''} (expected P-256, P-384 or P-521)`,
			);
	}
}

function detectEcCurve(keyObject: KeyObject): IdpSigningEcCurve {
	const details = keyObject.asymmetricKeyDetails;
	return namedCurveToLabel(details?.namedCurve);
}

export function detectCertKeyFamily(certPem: string): IdpSigningKeyFamily {
	const cert = new X509Certificate(certPem);
	const keyObject = cert.publicKey;
	const type = keyObject.asymmetricKeyType;
	if (type === 'rsa') {
		return 'rsa';
	}
	if (type === 'ec') {
		return 'ec';
	}
	throw new IdpCertValidationError('Certificate public key must be RSA or EC');
}

function probeSignVerify(
	certPem: string,
	privateKeyPem: string,
	nodeSignAlgorithm: string,
): boolean {
	const payload = 'nestidp-keypair-check';
	try {
		const signer = createSign(nodeSignAlgorithm);
		signer.update(payload);
		signer.end();
		const signature = signer.sign(privateKeyPem);
		const verifier = createVerify(nodeSignAlgorithm);
		verifier.update(payload);
		verifier.end();
		return verifier.verify(certPem, signature);
	} catch {
		return false;
	}
}

export function assertMatchingKeyTypes(certPem: string, privateKeyPem: string): KeyObject {
	const certFamily = detectCertKeyFamily(certPem);
	const normalizedKey = assertValidSigningPrivateKeyPem(privateKeyPem);
	const keyObject = createPrivateKey(normalizedKey);
	const keyFamily = detectKeyFamily(keyObject);
	if (certFamily !== keyFamily) {
		throw new IdpCertValidationError('Certificate and private key use different key types');
	}
	return keyObject;
}

export function inferStoredSigningCryptoFromPem(
	certPem: string,
	privateKeyPem: string,
): StoredSigningCrypto {
	const normalizedCert = assertValidSigningCertPem(certPem);
	const normalizedKey = assertValidSigningPrivateKeyPem(privateKeyPem);
	const certFamily = detectCertKeyFamily(normalizedCert);
	const keyObject = createPrivateKey(normalizedKey);
	const keyFamily = detectKeyFamily(keyObject);
	if (certFamily !== keyFamily) {
		throw new IdpCertValidationError('Certificate and private key use different key types');
	}

	const signatureAlgorithmId = defaultSignatureAlgorithmIdForKeyFamily(keyFamily);
	const option = getIdpSigningSignatureOption(signatureAlgorithmId)!;
	if (!probeSignVerify(normalizedCert, normalizedKey, option.nodeSignAlgorithm)) {
		throw new IdpCertValidationError('Certificate and private key do not match');
	}

	if (keyFamily === 'rsa') {
		return {
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: signatureAlgorithmId,
			signingRsaModulusBits: detectRsaModulusBits(keyObject),
			signingEcCurve: null,
		};
	}

	return {
		signingKeyFamily: 'ec',
		signingSignatureAlgorithmId: signatureAlgorithmId,
		signingRsaModulusBits: null,
		signingEcCurve: detectEcCurve(keyObject),
	};
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

// §18: `now` is injectable so expiry logic can be tested against a fixed clock.
export function isCertExpiringSoon(
	notAfterIso: string | null,
	warningDays: number,
	now: number = Date.now(),
): boolean {
	if (!notAfterIso) {
		return false;
	}
	const notAfter = new Date(notAfterIso).getTime();
	if (Number.isNaN(notAfter)) {
		return false;
	}
	const threshold = now + warningDays * MS_PER_DAY;
	return notAfter <= threshold;
}

export function validateSigningCertPair(
	certPem: string,
	privateKeyPem: string,
): {
	certPem: string;
	privateKeyPem: string;
	crypto: StoredSigningCrypto;
} {
	const normalizedCert = assertValidSigningCertPem(certPem);
	const normalizedKey = assertValidSigningPrivateKeyPem(privateKeyPem);
	const crypto = inferStoredSigningCryptoFromPem(normalizedCert, normalizedKey);
	return { certPem: normalizedCert, privateKeyPem: normalizedKey, crypto };
}

export function prismaCryptoPrimaryData(crypto: StoredSigningCrypto) {
	return {
		signingKeyFamily: crypto.signingKeyFamily,
		signingSignatureAlgorithmId: crypto.signingSignatureAlgorithmId,
		signingRsaModulusBits: crypto.signingRsaModulusBits,
		signingEcCurve: crypto.signingEcCurve,
	};
}

export function prismaCryptoPendingData(crypto: StoredSigningCrypto) {
	return {
		pendingSigningKeyFamily: crypto.signingKeyFamily,
		pendingSigningSignatureAlgorithmId: crypto.signingSignatureAlgorithmId,
		pendingSigningRsaModulusBits: crypto.signingRsaModulusBits,
		pendingSigningEcCurve: crypto.signingEcCurve,
	};
}
