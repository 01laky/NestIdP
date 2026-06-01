import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PASSWORD_HASH_ALGORITHM,
	isPasswordHashAlgorithm,
	PASSWORD_HASH_ALGORITHMS,
} from './password-hash-algorithms.js';

describe('password-hash-algorithms', () => {
	it('SH-PWD-01: DEFAULT_PASSWORD_HASH_ALGORITHM is bcrypt', () => {
		expect(DEFAULT_PASSWORD_HASH_ALGORITHM).toBe('bcrypt');
	});

	it('SH-PWD-02: isPasswordHashAlgorithm accepts bcrypt', () => {
		expect(isPasswordHashAlgorithm('bcrypt')).toBe(true);
	});

	it('SH-PWD-03: isPasswordHashAlgorithm rejects argon2 in v1', () => {
		expect(isPasswordHashAlgorithm('argon2')).toBe(false);
	});

	it('SH-PWD-04: rejects empty string and unknown algorithms', () => {
		expect(isPasswordHashAlgorithm('')).toBe(false);
		expect(isPasswordHashAlgorithm('md5')).toBe(false);
	});

	it('SH-PWD-05: PASSWORD_HASH_ALGORITHMS contains only bcrypt in v1', () => {
		expect(PASSWORD_HASH_ALGORITHMS).toEqual(['bcrypt']);
	});
});
