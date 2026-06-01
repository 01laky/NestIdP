/** Supported passwordHashAlgorithm values from external identity API (v1). */
export const PASSWORD_HASH_ALGORITHMS = ['bcrypt'] as const;
export type PasswordHashAlgorithm = (typeof PASSWORD_HASH_ALGORITHMS)[number];

export const DEFAULT_PASSWORD_HASH_ALGORITHM: PasswordHashAlgorithm = 'bcrypt';

export function isPasswordHashAlgorithm(value: string): value is PasswordHashAlgorithm {
	return (PASSWORD_HASH_ALGORITHMS as readonly string[]).includes(value);
}
