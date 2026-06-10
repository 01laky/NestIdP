import {
	createPublicKey,
	publicEncrypt,
	privateDecrypt,
	constants,
	X509Certificate,
	type KeyObject,
} from 'node:crypto';
import type { StoredEncryptionCrypto } from '@nestidp/shared';
import { IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID } from '@nestidp/shared';
import {
	assertMatchingKeyTypes,
	detectKeyFamily,
	fingerprintSha256Hex,
	IdpCertValidationError,
	namedCurveToLabel,
} from './idp-cert.util';
import { MAX_PEM_LENGTH } from '../../common/constants/crypto-limits';

export { IdpCertValidationError };

export function assertValidEncryptionCertPem(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpCertValidationError('encryptionCertPem is required');
	}
	if (trimmed.length > MAX_PEM_LENGTH) {
		throw new IdpCertValidationError('encryptionCertPem is too large');
	}
	if (!trimmed.includes('BEGIN CERTIFICATE') || !trimmed.includes('END CERTIFICATE')) {
		throw new IdpCertValidationError('encryptionCertPem must be a valid PEM certificate');
	}
	return trimmed;
}

export function assertValidEncryptionPrivateKeyPem(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpCertValidationError('encryptionPrivateKeyPem is required');
	}
	if (trimmed.length > MAX_PEM_LENGTH) {
		throw new IdpCertValidationError('encryptionPrivateKeyPem is too large');
	}
	if (!trimmed.includes('BEGIN') || !trimmed.includes('PRIVATE KEY')) {
		throw new IdpCertValidationError('encryptionPrivateKeyPem must be a valid PEM private key');
	}
	return trimmed;
}

function detectRsaModulusBits(keyObject: KeyObject): number {
	const length = keyObject.asymmetricKeyDetails?.modulusLength;
	if (!length) {
		throw new IdpCertValidationError('Unable to determine the RSA modulus size from the key');
	}
	return length;
}

function probeEncryptDecrypt(certPem: string, privateKeyPem: string): boolean {
	const payload = Buffer.from('nestidp-encryption-keypair-check');
	try {
		const publicKey = createPublicKey(certPem);
		const encrypted = publicEncrypt(
			{ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
			payload,
		);
		const decrypted = privateDecrypt(
			{ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
			encrypted,
		);
		return decrypted.equals(payload);
	} catch {
		return false;
	}
}

// KeyUsage extension: OID 2.5.29.15 (DER OID body `55 1D 0F`); its value is an OCTET STRING wrapping a
// BIT STRING whose first content byte carries the usage flags (keyEncipherment = bit 2 = 0x20,
// dataEncipherment = bit 3 = 0x10). The extension is only a handful of bytes, so the length octets are
// always short-form.
const KEY_USAGE_KEY_ENCIPHERMENT = 0x20;
const KEY_USAGE_DATA_ENCIPHERMENT = 0x10;

/**
 * True when the certificate's X.509 KeyUsage extension asserts Key Encipherment or Data Encipherment
 * (i.e. it is not signing-only). Parsed natively from the certificate DER — no `openssl` subprocess, so it
 * doesn't block the event loop or depend on the binary / its locale-specific output (Prompt 38 §B8).
 * `X509Certificate.keyUsage` cannot be used here: Node exposes the *extended* key usage there, not the
 * basic KeyUsage bit string.
 */
export function certHasEncryptionKeyUsage(certPem: string): boolean {
	let der: Buffer;
	try {
		der = new X509Certificate(certPem).raw;
	} catch {
		return false;
	}
	let i = -1;
	for (let k = 0; k + 5 <= der.length; k++) {
		if (
			der[k] === 0x06 &&
			der[k + 1] === 0x03 &&
			der[k + 2] === 0x55 &&
			der[k + 3] === 0x1d &&
			der[k + 4] === 0x0f
		) {
			i = k + 5;
			break;
		}
	}
	if (i < 0) {
		return false;
	}
	// optional `critical` BOOLEAN (01 01 xx)
	if (der[i] === 0x01 && der[i + 1] === 0x01) {
		i += 3;
	}
	// OCTET STRING (04 len) wrapping a BIT STRING (03 len unusedBits flags…)
	if (der[i] !== 0x04 || der[i + 2] !== 0x03) {
		return false;
	}
	const flags = der[i + 5]; // 04 <len> 03 <len> <unusedBits> <flags>
	return (
		(flags & KEY_USAGE_KEY_ENCIPHERMENT) !== 0 || (flags & KEY_USAGE_DATA_ENCIPHERMENT) !== 0
	);
}

export function assertEncryptionCertNotSigningOnly(certPem: string): void {
	if (!certHasEncryptionKeyUsage(certPem)) {
		throw new IdpCertValidationError(
			'Certificate must include Key Encipherment or Data Encipherment key usage (not signing-only)',
		);
	}
}

export function assertEncryptionCertDiffersFromSigningPrimary(
	encryptionCertPem: string,
	signingCertPem: string | null | undefined,
): void {
	if (!signingCertPem) {
		return;
	}
	const encFp = fingerprintSha256Hex(encryptionCertPem);
	const signFp = fingerprintSha256Hex(signingCertPem);
	if (encFp === signFp) {
		throw new IdpCertValidationError(
			'Encryption certificate must not be the same as the primary signing certificate',
		);
	}
}

export function inferStoredEncryptionCryptoFromPem(
	certPem: string,
	privateKeyPem: string,
): StoredEncryptionCrypto {
	const normalizedCert = assertValidEncryptionCertPem(certPem);
	const normalizedKey = assertValidEncryptionPrivateKeyPem(privateKeyPem);
	assertEncryptionCertNotSigningOnly(normalizedCert);
	const keyObject = assertMatchingKeyTypes(normalizedCert, normalizedKey);
	const keyFamily = detectKeyFamily(keyObject);

	if (keyFamily === 'rsa') {
		if (!probeEncryptDecrypt(normalizedCert, normalizedKey)) {
			throw new IdpCertValidationError('Certificate and private key do not match');
		}
		return {
			encryptionKeyFamily: 'rsa',
			encryptionKeyTransportAlgorithmId: IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
			encryptionRsaModulusBits: detectRsaModulusBits(keyObject),
			encryptionEcCurve: null,
		};
	}

	const details = keyObject.asymmetricKeyDetails;
	return {
		encryptionKeyFamily: 'ec',
		encryptionKeyTransportAlgorithmId: null,
		encryptionRsaModulusBits: null,
		encryptionEcCurve: namedCurveToLabel(details?.namedCurve),
	};
}

export function validateEncryptionKeyPair(
	certPem: string,
	privateKeyPem: string,
	signingCertPem?: string | null,
): {
	certPem: string;
	privateKeyPem: string;
	crypto: StoredEncryptionCrypto;
} {
	const normalizedCert = assertValidEncryptionCertPem(certPem);
	const normalizedKey = assertValidEncryptionPrivateKeyPem(privateKeyPem);
	assertEncryptionCertDiffersFromSigningPrimary(normalizedCert, signingCertPem);
	const crypto = inferStoredEncryptionCryptoFromPem(normalizedCert, normalizedKey);
	return { certPem: normalizedCert, privateKeyPem: normalizedKey, crypto };
}

export function prismaEncryptionPrimaryData(crypto: StoredEncryptionCrypto) {
	return {
		encryptionKeyFamily: crypto.encryptionKeyFamily,
		encryptionKeyTransportAlgorithmId: crypto.encryptionKeyTransportAlgorithmId,
		encryptionRsaModulusBits: crypto.encryptionRsaModulusBits,
		encryptionEcCurve: crypto.encryptionEcCurve,
	};
}

export function prismaEncryptionPendingData(crypto: StoredEncryptionCrypto) {
	return {
		pendingEncryptionKeyFamily: crypto.encryptionKeyFamily,
		pendingEncryptionKeyTransportAlgorithmId: crypto.encryptionKeyTransportAlgorithmId,
		pendingEncryptionRsaModulusBits: crypto.encryptionRsaModulusBits,
		pendingEncryptionEcCurve: crypto.encryptionEcCurve,
	};
}
