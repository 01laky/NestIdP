import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { certHasEncryptionKeyUsage } from '@api/idp-settings/utils/idp-encryption-cert.util';
import {
	assertValidSigningCertPem,
	assertValidSigningPrivateKeyPem,
	inferStoredSigningCryptoFromPem,
} from '@api/idp-settings/utils/idp-cert.util';

/**
 * Test-only X.509 certificate helpers (Prompt 38 §A13 / §6.10). These were previously exported from
 * production `src/idp-settings/utils/*`, where they had no production caller and only dragged test concerns
 * (RSA key generation, the openssl-`req` shell-out, the deprecated key-pair assertion) into the prod graph.
 * They are used exclusively by the idp-settings / SAML test suites and now live under `test/support`.
 */

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

/** @deprecated thin wrapper over inferStoredSigningCryptoFromPem, retained for the cert-util tests. */
export function assertMatchingKeyPair(certPem: string, privateKeyPem: string): void {
	inferStoredSigningCryptoFromPem(certPem, privateKeyPem);
}
