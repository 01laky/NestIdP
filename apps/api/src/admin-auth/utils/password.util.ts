import bcrypt from 'bcrypt';
import { BCRYPT_COST_FACTOR } from '@nestidp/shared';

/** Fixed bcrypt hash for timing-safe compare when user is not found. Never store in DB. */
export const DUMMY_BCRYPT_HASH = '$2b$12$zcTCx/30Q0fb4vtKLEENnOKvKzEOyt5XvwP2WLorLl5.Y/ozzx/E6';

export async function hashPassword(plaintext: string): Promise<string> {
	return bcrypt.hash(plaintext, BCRYPT_COST_FACTOR);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
	return bcrypt.compare(plaintext, hash);
}

export async function verifyPasswordTimingSafe(
	plaintext: string,
	hash: string | null,
): Promise<boolean> {
	const hadUser = hash !== null;
	const matched = await bcrypt.compare(plaintext, hash ?? DUMMY_BCRYPT_HASH);
	return hadUser && matched;
}
