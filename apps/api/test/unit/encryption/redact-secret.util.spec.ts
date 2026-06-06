import { redactBearerToken, redactSecrets } from '@api/encryption/utils/redact-secret.util';

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

describe('redactSecrets', () => {
	it('API-ENC-09: scrubs client_secret in form and JSON shapes', () => {
		expect(
			redactSecrets('grant_type=client_credentials&client_secret=hunter2&scope=read'),
		).not.toContain('hunter2');
		expect(redactSecrets('{"client_secret":"hunter2","grant_type":"x"}')).not.toContain('hunter2');
	});

	it('API-ENC-10: scrubs access_token / refresh_token / id_token', () => {
		expect(redactSecrets('access_token=abc.def.ghi&token_type=Bearer')).not.toContain(
			'abc.def.ghi',
		);
		expect(
			redactSecrets('{"access_token":"AT","refresh_token":"RT","id_token":"IDT"}'),
		).not.toMatch(/AT|RT|IDT/);
	});

	it('API-ENC-11: scrubs Authorization Bearer and Basic header values', () => {
		expect(redactSecrets('Authorization: Bearer abcdef....secret')).not.toContain('abcdefction');
		expect(redactSecrets('authorization=Basic dXNlcjpwYXNz')).not.toContain('dXNlcjpwYXNz');
	});

	it('API-ENC-12: leaves non-secret text intact and tolerates null/undefined', () => {
		expect(redactSecrets('just a normal message')).toBe('just a normal message');
		expect(redactSecrets(null)).toBe('');
		expect(redactSecrets(undefined)).toBe('');
	});

	it('API-ENC-13: keeps the key but masks the value', () => {
		expect(redactSecrets('client_secret=hunter2')).toContain('client_secret=');
		expect(redactSecrets('client_secret=hunter2')).toContain('[redacted]');
	});
});
