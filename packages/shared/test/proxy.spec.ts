import { describe, expect, it } from 'vitest';
import {
	hostBypassesProxy,
	parseNoProxyHosts,
	previewProxyRouting,
	ProxyConfigError,
	validateProxyUrl,
} from '@shared/proxy.js';

describe('validateProxyUrl (PROXY-CFG-01, PROXY-CFG-04)', () => {
	it('PROXY-CFG-01a: accepts well-formed http/https proxy URLs (normalized)', () => {
		expect(validateProxyUrl('http://proxy.corp.example:8080')).toBe(
			'http://proxy.corp.example:8080',
		);
		expect(validateProxyUrl('https://Proxy.Corp.Example:3128')).toBe(
			'https://proxy.corp.example:3128',
		);
		expect(validateProxyUrl('  http://proxy:8080/  ')).toBe('http://proxy:8080');
	});

	it('PROXY-CFG-01b: rejects other schemes / empty / malformed', () => {
		expect(() => validateProxyUrl('')).toThrow(ProxyConfigError);
		expect(() => validateProxyUrl('   ')).toThrow(/empty/);
		expect(() => validateProxyUrl('socks5://proxy:1080')).toThrow(/http:\/\/ or https:\/\//);
		expect(() => validateProxyUrl('ftp://proxy')).toThrow(ProxyConfigError);
		expect(() => validateProxyUrl('not a url')).toThrow(/valid absolute URL/);
		expect(() => validateProxyUrl('proxy.corp.example:8080')).toThrow(ProxyConfigError);
	});

	it('PROXY-CFG-04: rejects inline credentials in the proxy URL', () => {
		expect(() => validateProxyUrl('http://user:pass@proxy:8080')).toThrow(
			/must not embed credentials/,
		);
		expect(() => validateProxyUrl('http://user@proxy:8080')).toThrow(/must not embed credentials/);
	});

	it('PROXY-CFG-01c: rejects query/fragment', () => {
		expect(() => validateProxyUrl('http://proxy:8080?x=1')).toThrow(ProxyConfigError);
		expect(() => validateProxyUrl('http://proxy:8080#h')).toThrow(ProxyConfigError);
	});
});

describe('parseNoProxyHosts (PROXY-CFG-03)', () => {
	it('PROXY-CFG-03: trims, drops empties, lowercases, de-dupes', () => {
		expect(parseNoProxyHosts(' A.com, ,b.COM ,a.com')).toEqual(['a.com', 'b.com']);
		expect(parseNoProxyHosts('a.com b.com\nc.com')).toEqual(['a.com', 'b.com', 'c.com']);
		expect(parseNoProxyHosts(null)).toEqual([]);
		expect(parseNoProxyHosts('')).toEqual([]);
	});
});

describe('hostBypassesProxy (PROXY-CFG-02, PROXY-CFG-05, PROXY-CFG-06)', () => {
	it('PROXY-CFG-02a: exact host and host:port (explicit non-default port)', () => {
		expect(hostBypassesProxy('https://api.corp.example/u', 'api.corp.example')).toBe(true);
		expect(hostBypassesProxy('https://api.corp.example:8443/u', 'api.corp.example:8443')).toBe(
			true,
		);
		expect(hostBypassesProxy('https://api.corp.example:9443/u', 'api.corp.example:8443')).toBe(
			false,
		);
		// A default port is normalized away by URL, so host alone still matches.
		expect(hostBypassesProxy('https://api.corp.example:443/u', 'api.corp.example')).toBe(true);
	});

	it('PROXY-CFG-02b: leading-dot domain suffix', () => {
		expect(hostBypassesProxy('https://api.corp.example/u', '.corp.example')).toBe(true);
		expect(hostBypassesProxy('https://corp.example/u', '.corp.example')).toBe(true);
		expect(hostBypassesProxy('https://corp.example.com/u', '.corp.example')).toBe(false);
	});

	it('PROXY-CFG-02c: wildcard bypasses everything', () => {
		expect(hostBypassesProxy('https://anything.example/u', '*')).toBe(true);
	});

	it('PROXY-CFG-02d: localhost/127.0.0.1/::1 always bypass', () => {
		expect(hostBypassesProxy('http://localhost:3000/u', '')).toBe(true);
		expect(hostBypassesProxy('http://127.0.0.1/u', null)).toBe(true);
		expect(hostBypassesProxy('http://[::1]:8080/u', '')).toBe(true);
	});

	it('PROXY-CFG-02e: an unrelated host does not bypass', () => {
		expect(hostBypassesProxy('https://api.other.example/u', '.corp.example, x.com')).toBe(false);
	});

	it('PROXY-CFG-05a: IPv4 CIDR match', () => {
		expect(hostBypassesProxy('http://10.1.2.3/u', '10.0.0.0/8')).toBe(true);
		expect(hostBypassesProxy('http://10.1.2.3/u', '10.0.0.0/16')).toBe(false);
		expect(hostBypassesProxy('http://192.168.1.5/u', '192.168.0.0/16')).toBe(true);
		expect(hostBypassesProxy('http://11.0.0.1/u', '10.0.0.0/8')).toBe(false);
	});

	it('PROXY-CFG-05b: IPv6 CIDR match', () => {
		expect(hostBypassesProxy('http://[fd00::5]/u', 'fd00::/8')).toBe(true);
		expect(hostBypassesProxy('http://[fe00::5]/u', 'fd00::/8')).toBe(false);
	});

	it('PROXY-CFG-05c: DNS-name target never matches a CIDR; malformed CIDR ignored', () => {
		expect(hostBypassesProxy('https://api.corp.example/u', '10.0.0.0/8')).toBe(false);
		expect(hostBypassesProxy('http://10.1.2.3/u', '10.0.0.0/999')).toBe(false);
		expect(hostBypassesProxy('http://10.1.2.3/u', 'notacidr/8')).toBe(false);
	});

	it('PROXY-CFG-06: bracketed IPv6 target matches CIDR after bracket-strip', () => {
		expect(hostBypassesProxy('http://[fd00::1]:8443/u', 'fd00::/16')).toBe(true);
	});

	it('returns false for an unparseable target URL', () => {
		expect(hostBypassesProxy('::not a url::', '*')).toBe(false);
	});
});

describe('previewProxyRouting (PROXY-API-05)', () => {
	it('reports direct vs proxy per target', () => {
		const out = previewProxyRouting(true, '.corp.example', [
			{ label: 'baseUrl', url: 'https://api.corp.example/v1' },
			{ label: 'oauthTokenUrl', url: 'https://auth.other.example/token' },
		]);
		expect(out).toEqual([
			{ label: 'baseUrl', host: 'api.corp.example', routedThrough: 'direct' },
			{ label: 'oauthTokenUrl', host: 'auth.other.example', routedThrough: 'proxy' },
		]);
	});

	it('all direct when proxy disabled', () => {
		const out = previewProxyRouting(false, null, [{ label: 'baseUrl', url: 'https://x.example' }]);
		expect(out[0].routedThrough).toBe('direct');
	});

	it('skips null/empty target urls', () => {
		const out = previewProxyRouting(true, null, [
			{ label: 'baseUrl', url: null },
			{ label: 'tokenUrl', url: 'https://x.example' },
		]);
		expect(out).toHaveLength(1);
		expect(out[0].label).toBe('tokenUrl');
	});
});

// =================================================================================================
// Extended edge cases
// =================================================================================================

describe('validateProxyUrl — extended', () => {
	it('PROXY-CFG-EXT-01: accepts https + IPv6 literal + explicit port', () => {
		expect(validateProxyUrl('https://proxy.corp.example:3128')).toBe(
			'https://proxy.corp.example:3128',
		);
		expect(validateProxyUrl('http://[2001:db8::1]:8080')).toBe('http://[2001:db8::1]:8080');
	});

	it('PROXY-CFG-EXT-02: lowercases the host but preserves an explicit path', () => {
		expect(validateProxyUrl('http://Proxy.CORP.example:8080/gw')).toBe(
			'http://proxy.corp.example:8080/gw',
		);
	});

	it('PROXY-CFG-EXT-03: strips a lone trailing slash', () => {
		expect(validateProxyUrl('http://proxy:8080/')).toBe('http://proxy:8080');
	});

	it('PROXY-CFG-EXT-04: rejects scheme-only / host-less / space-embedded', () => {
		expect(() => validateProxyUrl('http://')).toThrow(ProxyConfigError);
		expect(() => validateProxyUrl('https://')).toThrow(ProxyConfigError);
		expect(() => validateProxyUrl('http://proxy host:8080')).toThrow(ProxyConfigError);
	});

	it('PROXY-CFG-EXT-05: rejects ws/file/data and protocol-relative', () => {
		for (const u of [
			'ws://proxy:8080',
			'file:///etc/passwd',
			'data:text/plain,x',
			'//proxy:8080',
		]) {
			expect(() => validateProxyUrl(u)).toThrow(ProxyConfigError);
		}
	});

	it('PROXY-CFG-EXT-06: rejects only a password (no username) embedded', () => {
		expect(() => validateProxyUrl('http://:pass@proxy:8080')).toThrow(/must not embed credentials/);
	});
});

describe('parseNoProxyHosts — extended', () => {
	it('PROXY-CFG-EXT-07: splits on commas, spaces, tabs, and newlines together', () => {
		expect(parseNoProxyHosts('a.com,\tb.com\n c.com   d.com')).toEqual([
			'a.com',
			'b.com',
			'c.com',
			'd.com',
		]);
	});

	it('PROXY-CFG-EXT-08: leading/trailing/duplicate separators produce no empty tokens', () => {
		expect(parseNoProxyHosts(',, a.com ,,, b.com ,,')).toEqual(['a.com', 'b.com']);
	});

	it('PROXY-CFG-EXT-09: case-folds and de-dupes case-variants', () => {
		expect(parseNoProxyHosts('API.Corp.Example, api.corp.example')).toEqual(['api.corp.example']);
	});
});

describe('hostBypassesProxy — extended CIDR + matching', () => {
	it('PROXY-CFG-EXT-10: /0 matches every IPv4 / IPv6 target', () => {
		expect(hostBypassesProxy('http://8.8.8.8/u', '0.0.0.0/0')).toBe(true);
		expect(hostBypassesProxy('http://203.0.113.9/u', '0.0.0.0/0')).toBe(true);
		expect(hostBypassesProxy('http://[2001:db8::99]/u', '::/0')).toBe(true);
	});

	it('PROXY-CFG-EXT-11: /32 and /128 are exact single-host matches', () => {
		expect(hostBypassesProxy('http://10.1.2.3/u', '10.1.2.3/32')).toBe(true);
		expect(hostBypassesProxy('http://10.1.2.4/u', '10.1.2.3/32')).toBe(false);
		expect(hostBypassesProxy('http://[fd00::1]/u', 'fd00::1/128')).toBe(true);
		expect(hostBypassesProxy('http://[fd00::2]/u', 'fd00::1/128')).toBe(false);
	});

	it('PROXY-CFG-EXT-12: a CIDR token with host bits set still matches the network', () => {
		// 10.5.6.7/8 → network 10.0.0.0/8
		expect(hostBypassesProxy('http://10.99.99.99/u', '10.5.6.7/8')).toBe(true);
		expect(hostBypassesProxy('http://11.0.0.1/u', '10.5.6.7/8')).toBe(false);
	});

	it('PROXY-CFG-EXT-13: IPv4 boundary — network and last address are inside', () => {
		expect(hostBypassesProxy('http://192.168.0.0/u', '192.168.0.0/16')).toBe(true);
		expect(hostBypassesProxy('http://192.168.255.255/u', '192.168.0.0/16')).toBe(true);
		expect(hostBypassesProxy('http://192.169.0.0/u', '192.168.0.0/16')).toBe(false);
	});

	it('PROXY-CFG-EXT-14: a v4 host never matches a v6 CIDR and vice versa', () => {
		expect(hostBypassesProxy('http://10.0.0.1/u', 'fd00::/8')).toBe(false);
		expect(hostBypassesProxy('http://[fd00::1]/u', '10.0.0.0/8')).toBe(false);
	});

	it('PROXY-CFG-EXT-15: handles compressed + full IPv6 forms equivalently', () => {
		expect(hostBypassesProxy('http://[2001:db8:0:0:0:0:0:1]/u', '2001:db8::/32')).toBe(true);
		expect(hostBypassesProxy('http://[2001:DB8::1]/u', '2001:db8::/32')).toBe(true);
		expect(hostBypassesProxy('http://[2001:db9::1]/u', '2001:db8::/32')).toBe(false);
	});

	it('PROXY-CFG-EXT-16: rejects malformed CIDR prefixes without throwing', () => {
		expect(hostBypassesProxy('http://10.0.0.1/u', '10.0.0.0/-1')).toBe(false);
		expect(hostBypassesProxy('http://10.0.0.1/u', '10.0.0.0/33')).toBe(false);
		expect(hostBypassesProxy('http://[fd00::1]/u', 'fd00::/129')).toBe(false);
		expect(hostBypassesProxy('http://10.0.0.1/u', '10.0.0.0/abc')).toBe(false);
	});

	it('PROXY-CFG-EXT-17: wildcard combined with other tokens still bypasses all', () => {
		expect(hostBypassesProxy('https://whatever.example/u', '.corp.example, *')).toBe(true);
	});

	it('PROXY-CFG-EXT-18: target host compare is case-insensitive', () => {
		expect(hostBypassesProxy('https://API.Corp.Example/u', '.corp.example')).toBe(true);
		expect(hostBypassesProxy('https://API.Corp.Example/u', 'api.corp.example')).toBe(true);
	});

	it('PROXY-CFG-EXT-19: leading-dot token does not match a different TLD', () => {
		expect(hostBypassesProxy('https://api.corp.example.com/u', '.corp.example')).toBe(false);
	});

	it('PROXY-CFG-EXT-20: empty / whitespace no-proxy means nothing bypasses (except always-list)', () => {
		expect(hostBypassesProxy('https://api.example/u', '   ')).toBe(false);
		expect(hostBypassesProxy('https://api.example/u', undefined)).toBe(false);
		expect(hostBypassesProxy('http://localhost/u', '   ')).toBe(true);
	});

	it('PROXY-CFG-EXT-21: accepts a pre-parsed token array', () => {
		expect(hostBypassesProxy('https://api.corp.example/u', ['x.com', '.corp.example'])).toBe(true);
	});
});

describe('previewProxyRouting — extended', () => {
	it('PROXY-CFG-EXT-22: base direct (bypassed) while token URL is proxied', () => {
		const out = previewProxyRouting(true, '.corp.example', [
			{ label: 'baseUrl', url: 'https://api.corp.example' },
			{ label: 'oauthTokenUrl', url: 'https://login.microsoftonline.com/token' },
		]);
		expect(out.find((r) => r.label === 'baseUrl')?.routedThrough).toBe('direct');
		expect(out.find((r) => r.label === 'oauthTokenUrl')?.routedThrough).toBe('proxy');
	});

	it('PROXY-CFG-EXT-23: unparseable target URL is reported as direct with null host', () => {
		const out = previewProxyRouting(true, null, [{ label: 'baseUrl', url: 'http://a b c' }]);
		expect(out[0]).toEqual({ label: 'baseUrl', host: null, routedThrough: 'direct' });
	});

	it('PROXY-CFG-EXT-24: CIDR no-proxy is honoured by the preview', () => {
		const out = previewProxyRouting(true, '10.0.0.0/8', [
			{ label: 'baseUrl', url: 'http://10.1.2.3:9000' },
		]);
		expect(out[0].routedThrough).toBe('direct');
	});
});
