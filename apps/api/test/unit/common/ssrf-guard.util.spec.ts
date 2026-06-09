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

	it('API-SSRF-06: case-insensitive on hostnames and IPv6 hex', () => {
		expect(isPrivateOrLoopbackHost('LOCALHOST')).toBe(true);
		expect(isPrivateOrLoopbackHost('DB.Internal')).toBe(true);
		expect(isPrivateOrLoopbackHost('FE80::1')).toBe(true);
		expect(isPrivateOrLoopbackHost('FC00::1')).toBe(true);
	});

	it('API-SSRF-07: covers loopback edges, 0.0.0.0/8 and the full 172.16/12 boundary', () => {
		expect(isPrivateOrLoopbackHost('127.255.255.255')).toBe(true);
		expect(isPrivateOrLoopbackHost('0.0.0.0')).toBe(true);
		expect(isPrivateOrLoopbackHost('0.1.2.3')).toBe(true);
		expect(isPrivateOrLoopbackHost('172.15.255.255')).toBe(false); // just below /12
		expect(isPrivateOrLoopbackHost('172.16.0.0')).toBe(true);
		expect(isPrivateOrLoopbackHost('172.31.255.255')).toBe(true);
		expect(isPrivateOrLoopbackHost('172.32.0.0')).toBe(false); // just above /12
	});

	it('API-SSRF-08: CGNAT 100.64/10 boundary is exact', () => {
		expect(isPrivateOrLoopbackHost('100.63.255.255')).toBe(false); // below
		expect(isPrivateOrLoopbackHost('100.64.0.0')).toBe(true);
		expect(isPrivateOrLoopbackHost('100.127.255.255')).toBe(true);
		expect(isPrivateOrLoopbackHost('100.128.0.0')).toBe(false); // above
	});

	it('API-SSRF-09: IPv6 unspecified and IPv4-mapped public address handled correctly', () => {
		expect(isPrivateOrLoopbackHost('::')).toBe(true);
		expect(isPrivateOrLoopbackHost('::ffff:8.8.8.8')).toBe(false); // mapped PUBLIC → allowed
		expect(isPrivateOrLoopbackHost('::ffff:10.0.0.1')).toBe(true); // mapped private → blocked
	});

	it('API-SSRF-10: malformed IPv4-looking strings fall through as hostnames, never throw', () => {
		// Not 4 octets / out-of-range octets are not IPv4 → treated as opaque hostnames (not blocked here).
		expect(isPrivateOrLoopbackHost('1.2.3')).toBe(false);
		expect(isPrivateOrLoopbackHost('1.2.3.4.5')).toBe(false);
		expect(isPrivateOrLoopbackHost('256.1.1.1')).toBe(false);
		expect(isPrivateOrLoopbackHost('10.0.0.-1')).toBe(false);
		expect(isPrivateOrLoopbackHost('')).toBe(false);
	});

	it('API-SSRF-11: assertNotPrivateHost honours userinfo/port and bracketed IPv6 literals', () => {
		expect(() => assertNotPrivateHost('http://user:pw@127.0.0.1/x')).toThrow(SsrfBlockedError);
		expect(() => assertNotPrivateHost('http://[::1]:9000/meta')).toThrow(SsrfBlockedError);
		expect(() => assertNotPrivateHost('http://[fe80::1]/x')).toThrow(SsrfBlockedError);
		expect(() => assertNotPrivateHost('https://[2606:4700::1111]/x')).not.toThrow(); // public IPv6
		expect(() => assertNotPrivateHost('https://api.partner.example:8443/acs')).not.toThrow();
	});

	it('API-SSRF-12: the SsrfBlockedError carries the offending host and a stable name', () => {
		try {
			assertNotPrivateHost('http://169.254.169.254/');
			throw new Error('expected to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(SsrfBlockedError);
			expect((err as SsrfBlockedError).name).toBe('SsrfBlockedError');
			expect((err as SsrfBlockedError).message).toContain('169.254.169.254');
		}
	});
});
