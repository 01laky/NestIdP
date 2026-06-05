import { decrypt, encrypt } from '@api/encryption/utils/encryption.util';

const TEST_KEY = 'test-encryption-key-32chars!!';

describe('encryption.util', () => {
	it('API-ENC-01: round-trip encrypt → decrypt equals original', () => {
		const plaintext = 'my-secret-bearer-token';
		const ciphertext = encrypt(plaintext, TEST_KEY);
		expect(decrypt(ciphertext, TEST_KEY)).toBe(plaintext);
	});

	it('API-ENC-02: tampered ciphertext → decrypt throws', () => {
		const ciphertext = encrypt('token', TEST_KEY);
		const tampered = `${ciphertext.slice(0, -4)}XXXX`;
		expect(() => decrypt(tampered, TEST_KEY)).toThrow();
	});

	it('API-ENC-03: wrong encryption key → decrypt throws', () => {
		const ciphertext = encrypt('token', TEST_KEY);
		expect(() => decrypt(ciphertext, 'other-encryption-key-32chars!')).toThrow();
	});

	it('API-ENC-04: two encryptions of same plaintext → different ciphertext', () => {
		const a = encrypt('same-token', TEST_KEY);
		const b = encrypt('same-token', TEST_KEY);
		expect(a).not.toBe(b);
	});

	it('API-ENC-05: empty string plaintext round-trips', () => {
		const ciphertext = encrypt('', TEST_KEY);
		expect(decrypt(ciphertext, TEST_KEY)).toBe('');
	});

	it('API-ENC-06: ciphertext has v1: prefix', () => {
		expect(encrypt('token', TEST_KEY).startsWith('v1:')).toBe(true);
	});

	it('API-ENC-07: ENCRYPTION_KEY shorter than 16 chars → encrypt throws', () => {
		expect(() => encrypt('token', 'short-key')).toThrow(/at least 16 characters/);
	});

	it('API-ENC-09: unsupported ciphertext version throws', () => {
		expect(() => decrypt('v2:abc', TEST_KEY)).toThrow(/Unsupported ciphertext format/);
	});

	it('API-ENC-10: decrypt rejects truncated ciphertext', () => {
		expect(() => decrypt('v1:YQ==', TEST_KEY)).toThrow();
	});

	it('API-ENC-11: unicode plaintext round-trips', () => {
		const plaintext = 'token-🔐-unicode';
		expect(decrypt(encrypt(plaintext, TEST_KEY), TEST_KEY)).toBe(plaintext);
	});
});
