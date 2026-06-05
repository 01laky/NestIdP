import { redactBearerToken } from '@api/encryption/utils/redact-secret.util';

describe('redactBearerToken', () => {
	it('API-ENC-08: redactBearerToken never returns full bearer string', () => {
		const token = 'super-secret-bearer-token-value';
		const redacted = redactBearerToken(token);
		expect(redacted).not.toBe(token);
		expect(redacted).toContain('…');
		expect(redacted.startsWith('supe')).toBe(true);
		expect(redacted.endsWith('alue')).toBe(true);
	});

	it('returns [redacted] for null, undefined, empty, and short values', () => {
		expect(redactBearerToken(null)).toBe('[redacted]');
		expect(redactBearerToken(undefined)).toBe('[redacted]');
		expect(redactBearerToken('')).toBe('[redacted]');
		expect(redactBearerToken('short')).toBe('[redacted]');
	});
});
