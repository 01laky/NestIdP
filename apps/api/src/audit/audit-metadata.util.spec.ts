import { sanitizeAuditMetadata } from './audit-metadata.util';

describe('sanitizeAuditMetadata', () => {
	it('API-AUD-META-01: returns null for null input', () => {
		expect(sanitizeAuditMetadata(null)).toBeNull();
	});

	it('API-AUD-META-02: returns null for undefined input', () => {
		expect(sanitizeAuditMetadata(undefined)).toBeNull();
	});

	it('API-AUD-META-03: returns null for non-object input', () => {
		expect(sanitizeAuditMetadata('string' as unknown as Record<string, unknown>)).toBeNull();
	});

	it('API-AUD-META-04: strips password key case-insensitively', () => {
		expect(sanitizeAuditMetadata({ Password: 'secret', action: 'login' })).toEqual({
			action: 'login',
		});
	});

	it('API-AUD-META-05: strips bearerToken and secret keys', () => {
		expect(
			sanitizeAuditMetadata({
				bearerToken: 'tok',
				secret: 's',
				name: 'Corp',
			}),
		).toEqual({ name: 'Corp' });
	});

	it('API-AUD-META-06: strips signingPrivateKeyPem and authCredentialsEncrypted', () => {
		expect(
			sanitizeAuditMetadata({
				signingPrivateKeyPem: '-----BEGIN PRIVATE KEY-----',
				authCredentialsEncrypted: 'v1:enc',
				fields: ['entityId'],
			}),
		).toEqual({ fields: ['entityId'] });
	});

	it('API-AUD-META-07: passes through safe metadata unchanged', () => {
		const metadata = { username: 'admin', reachable: true, statusCode: 200 };
		expect(sanitizeAuditMetadata(metadata)).toEqual(metadata);
	});

	it('API-AUD-META-08: truncates metadata exceeding 4096 bytes', () => {
		const metadata = { payload: 'x'.repeat(5000) };
		expect(sanitizeAuditMetadata(metadata)).toEqual({
			truncated: true,
			previewBytes: 4096,
		});
	});

	it('API-AUD-META-09: empty object when all keys are denylisted', () => {
		expect(
			sanitizeAuditMetadata({
				password: 'p',
				token: 't',
				authorization: 'Bearer x',
			}),
		).toEqual({});
	});

	it('API-AUD-META-10: nested values in safe keys are preserved', () => {
		expect(sanitizeAuditMetadata({ fields: ['a', 'b'], rotation: false })).toEqual({
			fields: ['a', 'b'],
			rotation: false,
		});
	});
});
