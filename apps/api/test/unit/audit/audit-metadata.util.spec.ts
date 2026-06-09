import { sanitizeAuditMetadata } from '@api/audit/utils/audit-metadata.util';

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

	it('API-AUD-META-11: redacts secret keys nested at any depth (§5.A12)', () => {
		expect(
			sanitizeAuditMetadata({
				details: { password: 'p', user: 'admin' },
				connection: { proxy: { proxyPassword: 'x', host: 'h' } },
				list: [{ apiKey: 'k', label: 'ok' }],
			}),
		).toEqual({
			details: { user: 'admin' },
			connection: { proxy: { host: 'h' } },
			list: [{ label: 'ok' }],
		});
	});

	it('API-AUD-META-12: substring match catches secret variants (§5.A12)', () => {
		expect(
			sanitizeAuditMetadata({
				oauthClientSecret: 's',
				apiKey: 'k',
				signingKeyEncrypted: 'v1:enc',
				csrfToken: 't',
				ssoSessionId: 'keep-me',
				name: 'Corp',
			}),
		).toEqual({ ssoSessionId: 'keep-me', name: 'Corp' });
	});

	it('API-AUD-META-13: byte cap measures UTF-8 bytes not UTF-16 code units (§5.A12)', () => {
		// 1500 multi-byte chars = 4500 UTF-8 bytes (>4096) but only 1500 UTF-16 code units.
		const metadata = { payload: '€'.repeat(1500) };
		expect(sanitizeAuditMetadata(metadata)).toEqual({ truncated: true, previewBytes: 4096 });
	});
});
