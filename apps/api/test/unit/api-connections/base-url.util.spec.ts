import {
	assertValidBaseUrl,
	BaseUrlValidationError,
} from '@api/api-connections/utils/base-url.util';

describe('base-url.util', () => {
	it('API-URL-01: strips trailing slash', () => {
		expect(assertValidBaseUrl('https://identity.example.com/')).toBe(
			'https://identity.example.com',
		);
		expect(assertValidBaseUrl('https://identity.example.com/api/')).toBe(
			'https://identity.example.com/api',
		);
	});

	it('API-URL-02: rejects invalid URL', () => {
		expect(() => assertValidBaseUrl('not-a-url')).toThrow(BaseUrlValidationError);
	});

	it('API-URL-03: rejects javascript: scheme', () => {
		expect(() => assertValidBaseUrl('javascript:alert(1)')).toThrow(BaseUrlValidationError);
	});

	it('API-URL-04: rejects URL with embedded credentials', () => {
		expect(() => assertValidBaseUrl('https://user:pass@host.example.com')).toThrow(
			BaseUrlValidationError,
		);
		expect(() => assertValidBaseUrl('https://user:pass@host.example.com')).toThrow(
			/baseUrl must not contain credentials/,
		);
	});

	it('API-URL-05: rejects fragment', () => {
		expect(() => assertValidBaseUrl('https://host.example.com/path#frag')).toThrow(
			BaseUrlValidationError,
		);
	});

	it('API-URL-06: production mode rejects http:', () => {
		expect(() => assertValidBaseUrl('http://identity.example.com', { requireHttps: true })).toThrow(
			/baseUrl must use HTTPS in production/,
		);
	});

	it('API-URL-07: lowercases hostname', () => {
		expect(assertValidBaseUrl('https://IDENTITY.EXAMPLE.COM')).toBe('https://identity.example.com');
	});

	it('API-URL-08: rejects file: scheme', () => {
		expect(() => assertValidBaseUrl('file:///etc/passwd')).toThrow(BaseUrlValidationError);
	});

	it('API-URL-09: rejects empty string', () => {
		expect(() => assertValidBaseUrl('   ')).toThrow(BaseUrlValidationError);
	});

	it('API-URL-10: trims surrounding whitespace', () => {
		expect(assertValidBaseUrl('  https://identity.example.com  ')).toBe(
			'https://identity.example.com',
		);
	});

	it('API-URL-11: rejects username-only in URL (no password)', () => {
		expect(() => assertValidBaseUrl('https://user@host.example.com')).toThrow(
			/baseUrl must not contain credentials/,
		);
	});
});
