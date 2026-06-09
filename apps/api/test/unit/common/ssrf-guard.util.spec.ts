import {
	assertNotPrivateHost,
	isPrivateOrLoopbackHost,
	SsrfBlockedError,
} from '@api/common/utils/ssrf-guard.util';

describe('ssrf-guard (§5.A10)', () => {
	it('API-SSRF-01: blocks loopback, localhost and link-local metadata host', () => {
		expect(isPrivateOrLoopbackHost('127.0.0.1')).toBe(true);
		expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
		expect(isPrivateOrLoopbackHost('169.254.169.254')).toBe(true); // cloud metadata
		expect(isPrivateOrLoopbackHost('::1')).toBe(true);
	});

	it('API-SSRF-02: blocks RFC1918 private ranges', () => {
		expect(isPrivateOrLoopbackHost('10.1.2.3')).toBe(true);
		expect(isPrivateOrLoopbackHost('172.16.0.1')).toBe(true);
		expect(isPrivateOrLoopbackHost('172.31.255.255')).toBe(true);
		expect(isPrivateOrLoopbackHost('192.168.1.1')).toBe(true);
		expect(isPrivateOrLoopbackHost('100.64.0.1')).toBe(true); // CGNAT
	});

	it('API-SSRF-03: blocks internal hostname suffixes + IPv4-mapped IPv6 metadata', () => {
		expect(isPrivateOrLoopbackHost('service.internal')).toBe(true);
		expect(isPrivateOrLoopbackHost('db.local')).toBe(true);
		expect(isPrivateOrLoopbackHost('::ffff:169.254.169.254')).toBe(true);
		expect(isPrivateOrLoopbackHost('fe80::1')).toBe(true);
		expect(isPrivateOrLoopbackHost('fc00::1')).toBe(true);
	});

	it('API-SSRF-04: allows ordinary public hosts', () => {
		expect(isPrivateOrLoopbackHost('example.com')).toBe(false);
		expect(isPrivateOrLoopbackHost('sp.partner.org')).toBe(false);
		expect(isPrivateOrLoopbackHost('8.8.8.8')).toBe(false);
		expect(isPrivateOrLoopbackHost('172.32.0.1')).toBe(false); // just outside 172.16/12
	});

	it('API-SSRF-05: assertNotPrivateHost throws SsrfBlockedError for blocked + malformed URLs', () => {
		expect(() => assertNotPrivateHost('http://169.254.169.254/latest/meta-data/')).toThrow(
			SsrfBlockedError,
		);
		expect(() => assertNotPrivateHost('https://localhost:8080/acs')).toThrow(SsrfBlockedError);
		expect(() => assertNotPrivateHost('not a url')).toThrow(SsrfBlockedError);
		expect(() => assertNotPrivateHost('https://acs.example.com/saml')).not.toThrow();
	});
});
