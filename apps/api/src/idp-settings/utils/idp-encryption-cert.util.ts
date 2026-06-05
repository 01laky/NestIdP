import { execSync } from 'node:child_process';
import {
	createPublicKey,
	generateKeyPairSync,
	publicEncrypt,
	privateDecrypt,
	constants,
	type KeyObject,
} from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEncryptionCrypto } from '@nestidp/shared';
import { IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID } from '@nestidp/shared';
import {
	assertMatchingKeyTypes,
	assertValidSigningCertPem,
	assertValidSigningPrivateKeyPem,
	detectKeyFamily,
	fingerprintSha256Hex,
	IdpCertValidationError,
	inferStoredSigningCryptoFromPem,
	namedCurveToLabel,
} from './idp-cert.util';

export { IdpCertValidationError };

const MAX_PEM_LENGTH = 16_384;

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
	const details = keyObject.asymmetricKeyDetails;
	return details?.modulusLength ?? 2048;
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

export function certHasEncryptionKeyUsage(certPem: string): boolean {
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-ku-'));
	try {
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(certPath, certPem);
		const out = execSync(`openssl x509 -in "${certPath}" -ext keyUsage -noout`, {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		if (/No extensions in certificate/i.test(out)) {
			return false;
		}
		return /Key Encipherment|Data Encipherment/i.test(out);
	} catch {
		return false;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
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

/** Build a test encryption cert with proper key usage (for fixtures). */
export function generateTestRsaEncryptionCert(
	entityId: string,
	days = 365,
	modulusLength = 2048,
): { privateKeyPem: string; certPem: string } {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-test-enc-cert-'));
	try {
		const keyPath = join(tmp, 'key.pem');
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(keyPath, privateKey);
		const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
		execSync(
			`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days ${days} -subj "/CN=${cn}" -nodes -addext keyUsage=keyEncipherment,dataEncipherment`,
			{ stdio: 'pipe' },
		);
		return { privateKeyPem: privateKey, certPem: readFileSync(certPath, 'utf8') };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

/** Detect uploaded signing cert mistakenly used as encryption cert. */
export function isSigningOnlyCertPair(certPem: string, privateKeyPem: string): boolean {
	try {
		const normalizedCert = assertValidSigningCertPem(certPem);
		const normalizedKey = assertValidSigningPrivateKeyPem(privateKeyPem);
		inferStoredSigningCryptoFromPem(normalizedCert, normalizedKey);
		return !certHasEncryptionKeyUsage(normalizedCert);
	} catch {
		return false;
	}
}
