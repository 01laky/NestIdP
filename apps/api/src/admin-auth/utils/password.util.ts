import bcrypt from 'bcrypt';
import { BCRYPT_COST_FACTOR } from '@nestidp/shared';

/** Fixed cost-12 bcrypt hash — fallback only; see {@link getDummyBcryptHash}. Never store in DB. */
export const DUMMY_BCRYPT_HASH = '$2b$12$zcTCx/30Q0fb4vtKLEENnOKvKzEOyt5XvwP2WLorLl5.Y/ozzx/E6';

// §5.C: the "user not found" dummy compare must cost the same as a real compare. A hash pinned at cost 12
// diverges (timing oracle) as soon as BCRYPT_COST_FACTOR changes, so derive the dummy lazily from the
// configured cost and cache it per cost.
let cachedDummyHash: { cost: number; hash: string } | null = null;

export function getDummyBcryptHash(cost: number = BCRYPT_COST_FACTOR): string {
	if (cachedDummyHash?.cost !== cost) {
		try {
			cachedDummyHash = { cost, hash: bcrypt.hashSync('dummy-password', cost) };
		} catch {
			return DUMMY_BCRYPT_HASH;
		}
	}
	return cachedDummyHash.hash;
}

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
	const matched = await bcrypt.compare(plaintext, hash ?? getDummyBcryptHash());
	return hadUser && matched;
}
