import { NodeEnv } from '@api/config/env.validation';
import { assertValidAcsUrl, AcsUrlValidationError } from '@api/common/utils/acs-url.util';

describe('assertValidAcsUrl', () => {
	it('API-ACS-01: trims and accepts https ACS URL', () => {
		expect(assertValidAcsUrl('  https://sp.example.com/acs  ', 'test')).toBe(
			'https://sp.example.com/acs',
		);
	});

	it('API-ACS-02: strips trailing slash on path', () => {
		expect(assertValidAcsUrl('https://sp.example.com/acs/', 'test')).toBe(
			'https://sp.example.com/acs',
		);
	});

	it('API-ACS-03: rejects empty string', () => {
		expect(() => assertValidAcsUrl('', 'test')).toThrow(AcsUrlValidationError);
		expect(() => assertValidAcsUrl('   ', 'test')).toThrow('Invalid ACS URL');
	});

	it('API-ACS-04: rejects non-URL', () => {
		expect(() => assertValidAcsUrl('not-a-url', 'test')).toThrow('Invalid ACS URL');
	});

	it('API-ACS-05: rejects ftp protocol', () => {
		expect(() => assertValidAcsUrl('ftp://sp.example.com/acs', 'test')).toThrow('Invalid ACS URL');
	});

	it('API-ACS-06: rejects embedded credentials', () => {
		expect(() => assertValidAcsUrl('https://user:pass@sp.example.com/acs', 'test')).toThrow(
			'acsUrl must not contain credentials',
		);
	});

	it('API-ACS-07: rejects hash fragment', () => {
		expect(() => assertValidAcsUrl('https://sp.example.com/acs#fragment', 'test')).toThrow(
			'Invalid ACS URL',
		);
	});

	it('API-ACS-08: requires HTTPS in production', () => {
		expect(() => assertValidAcsUrl('http://sp.example.com/acs', NodeEnv.Production)).toThrow(
			'ACS URL must use HTTPS in production',
		);
	});

	it('API-ACS-09: allows http in non-production', () => {
		expect(assertValidAcsUrl('http://sp.example.com/acs', 'development')).toBe(
			'http://sp.example.com/acs',
		);
	});

	it('API-ACS-10: normalizes trailing slash on root URL', () => {
		expect(assertValidAcsUrl('https://sp.example.com/', 'test')).toBe('https://sp.example.com');
	});
});
