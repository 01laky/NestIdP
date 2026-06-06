import { describe, expect, it } from 'vitest';
import {
	assertValidOAuthConfig,
	assertValidOAuthTokenRequestParams,
	isOAuthClientAuthMethod,
	OAUTH_CLIENT_AUTH_METHODS,
	OAuthConfigValidationError,
} from '../src/index.js';

const base = {
	oauthTokenUrl: 'https://idp.example.com/oauth/token',
	oauthClientId: 'client-1',
};

describe('oauth config validation', () => {
	it('OAUTH-CFG-01: valid config resolves with defaults', () => {
		const r = assertValidOAuthConfig(base);
		expect(r.oauthTokenUrl).toBe(base.oauthTokenUrl);
		expect(r.oauthClientAuthMethod).toBe('client_secret_post');
		expect(r.oauthScope).toBeNull();
	});

	it('OAUTH-CFG-02: token URL must be absolute http(s)', () => {
		expect(() => assertValidOAuthConfig({ ...base, oauthTokenUrl: 'ftp://x/token' })).toThrow(
			OAuthConfigValidationError,
		);
		expect(() => assertValidOAuthConfig({ ...base, oauthTokenUrl: '/token' })).toThrow();
		expect(() =>
			assertValidOAuthConfig({ ...base, oauthTokenUrl: 'file:///etc/passwd' }),
		).toThrow();
	});

	it('OAUTH-CFG-03: token URL must not embed credentials or whitespace', () => {
		expect(() =>
			assertValidOAuthConfig({ ...base, oauthTokenUrl: 'https://user:pass@idp/token' }),
		).toThrow(/credentials/);
		expect(() => assertValidOAuthConfig({ ...base, oauthTokenUrl: 'https://idp/ token' })).toThrow(
			/whitespace/,
		);
	});

	it('OAUTH-CFG-04: client id required', () => {
		expect(() => assertValidOAuthConfig({ ...base, oauthClientId: '' })).toThrow(/oauthClientId/);
	});

	it('OAUTH-CFG-05: client auth method must be in the catalog', () => {
		expect(() =>
			assertValidOAuthConfig({ ...base, oauthClientAuthMethod: 'private_key_jwt' }),
		).toThrow(/oauthClientAuthMethod/);
		expect(
			assertValidOAuthConfig({ ...base, oauthClientAuthMethod: 'client_secret_basic' })
				.oauthClientAuthMethod,
		).toBe('client_secret_basic');
	});

	it('OAUTH-CFG-06: extra token params — reserved names rejected, shape validated', () => {
		expect(() => assertValidOAuthTokenRequestParams({ grant_type: 'x' })).toThrow(/reserved/);
		expect(() => assertValidOAuthTokenRequestParams({ client_secret: 'x' })).toThrow(/reserved/);
		expect(() => assertValidOAuthTokenRequestParams([] as never)).toThrow();
		expect(() => assertValidOAuthTokenRequestParams({ k: 123 as never })).toThrow();
		expect(assertValidOAuthTokenRequestParams({ resource: 'r1' })).toEqual({ resource: 'r1' });
		expect(assertValidOAuthTokenRequestParams(null)).toBeNull();
	});

	it('OAUTH-CFG-07: extra token params cap (≤ 20 entries)', () => {
		const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
		expect(() => assertValidOAuthTokenRequestParams(tooMany)).toThrow(/20/);
	});

	it('OAUTH-CFG-08: isOAuthClientAuthMethod + catalog', () => {
		expect(isOAuthClientAuthMethod('client_secret_post')).toBe(true);
		expect(isOAuthClientAuthMethod('nope')).toBe(false);
		expect(OAUTH_CLIENT_AUTH_METHODS.map((m) => m.id)).toEqual([
			'client_secret_post',
			'client_secret_basic',
		]);
	});

	// --- extended edge cases ---

	it('OAUTH-CFG-09: http and URLs with port/path/query are accepted; values are trimmed', () => {
		const r = assertValidOAuthConfig({
			oauthTokenUrl: '  http://idp.local:8443/realms/x/token?foo=bar  ',
			oauthClientId: '  client-1  ',
			oauthScope: '  read  ',
			oauthAudience: '  aud  ',
		});
		expect(r.oauthTokenUrl).toBe('http://idp.local:8443/realms/x/token?foo=bar');
		expect(r.oauthClientId).toBe('client-1');
		expect(r.oauthScope).toBe('read');
		expect(r.oauthAudience).toBe('aud');
	});

	it('OAUTH-CFG-10: blank scope/audience normalize to null; undefined auth method → default', () => {
		const r = assertValidOAuthConfig({
			...base,
			oauthScope: '   ',
			oauthAudience: '',
			oauthClientAuthMethod: undefined,
		});
		expect(r.oauthScope).toBeNull();
		expect(r.oauthAudience).toBeNull();
		expect(r.oauthClientAuthMethod).toBe('client_secret_post');
	});

	it('OAUTH-CFG-11: token URL without a host is rejected', () => {
		expect(() => assertValidOAuthConfig({ ...base, oauthTokenUrl: 'https://' })).toThrow();
	});

	it('OAUTH-CFG-12: oversize token URL / client id / scope are rejected', () => {
		const long = 'x'.repeat(1100);
		expect(() => assertValidOAuthConfig({ ...base, oauthTokenUrl: `https://idp/${long}` })).toThrow(
			/too long/,
		);
		expect(() => assertValidOAuthConfig({ ...base, oauthClientId: long })).toThrow(/too long/);
		expect(() => assertValidOAuthConfig({ ...base, oauthScope: long })).toThrow(/too long/);
	});

	it('OAUTH-CFG-13: token param empty key, oversize key/value rejected', () => {
		expect(() => assertValidOAuthTokenRequestParams({ '': 'v' })).toThrow();
		expect(() => assertValidOAuthTokenRequestParams({ ['k'.repeat(300)]: 'v' })).toThrow();
		expect(() => assertValidOAuthTokenRequestParams({ k: 'v'.repeat(300) })).toThrow();
	});
});
