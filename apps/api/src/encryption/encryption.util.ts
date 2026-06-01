import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION_PREFIX = 'v1:';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_KEY_LENGTH = 16;

function deriveKey(encryptionKey: string): Buffer {
	if (encryptionKey.length < MIN_KEY_LENGTH) {
		throw new Error(`ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters`);
	}
	return createHash('sha256').update(encryptionKey, 'utf8').digest();
}

export function encrypt(plaintext: string, encryptionKey: string): string {
	const key = deriveKey(encryptionKey);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	const payload = Buffer.concat([iv, authTag, encrypted]);
	return `${VERSION_PREFIX}${payload.toString('base64')}`;
}

export function decrypt(ciphertext: string, encryptionKey: string): string {
	if (!ciphertext.startsWith(VERSION_PREFIX)) {
		throw new Error('Unsupported ciphertext format');
	}
	const key = deriveKey(encryptionKey);
	const raw = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), 'base64');
	if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error('Ciphertext too short');
	}
	const iv = raw.subarray(0, IV_LENGTH);
	const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
