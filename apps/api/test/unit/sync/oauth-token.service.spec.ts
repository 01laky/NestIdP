import { ConfigService } from '@nestjs/config';
import type { ApiConnection } from '@prisma/client';
import { OAuthTokenError, OAuthTokenService } from '@api/sync/services/oauth-token.service';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';

function jsonResponse(body: unknown, status = 200): Response {
	return { status, json: async () => body } as Response;
}

function bodyString(call: unknown[]): string {
	const init = call[1] as { body?: unknown };
	return String(init?.body ?? '');
}
function headerOf(call: unknown[], name: string): string | undefined {
	const init = call[1] as { headers?: Record<string, string> };
	return init?.headers?.[name];
}

describe('OAuthTokenService', () => {
	// Identity "encryption": decrypt returns the ciphertext verbatim, so changing the stored
	// secret changes the resolved secret (and thus the cache key) — models rotation.
	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn((s: string) => s),
		decrypt: jest.fn((s: string) => s),
	};
	const audit = { recordSafe: jest.fn() };
	const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

	let service: OAuthTokenService;

	function makeConn(overrides: Partial<ApiConnection> = {}): ApiConnection {
		return {
			id: 'c1',
			authType: 'OAUTH2_CLIENT_CREDENTIALS',
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthClientSecretEncrypted: 'super-secret',
			oauthScope: 'read',
			oauthAudience: 'aud-1',
			oauthClientAuthMethod: 'client_secret_post',
			oauthTokenRequestParams: null,
			...overrides,
		} as unknown as ApiConnection;
	}

	beforeEach(() => {
		jest.restoreAllMocks();
		audit.recordSafe.mockReset();
		service = new OAuthTokenService(config, encryption, audit as never);
	});

	it('OAUTH-01: client_secret_post sends grant_type/client_id/client_secret/scope/audience', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(
				jsonResponse({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600 }),
			);
		const token = await service.getAccessToken(makeConn());
		expect(token).toBe('AT');
		const body = bodyString(fetchMock.mock.calls[0]);
		expect(body).toContain('grant_type=client_credentials');
		expect(body).toContain('client_id=client-1');
		expect(body).toContain('client_secret=super-secret');
		expect(body).toContain('scope=read');
		expect(body).toContain('audience=aud-1');
	});

	it('OAUTH-02: client_secret_basic uses Authorization Basic; secret NOT in body', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(makeConn({ oauthClientAuthMethod: 'client_secret_basic' }));
		expect(headerOf(fetchMock.mock.calls[0], 'Authorization')).toBe(
			`Basic ${Buffer.from('client-1:super-secret').toString('base64')}`,
		);
		expect(bodyString(fetchMock.mock.calls[0])).not.toContain('super-secret');
	});

	it('OAUTH-03: cache hit — second call within TTL does not re-POST', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn());
		await service.getAccessToken(makeConn());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('OAUTH-04: expiry forces a new POST (skew consumes a short TTL)', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 30 }));
		await service.getAccessToken(makeConn()); // clamp 30, effectiveTtl = 30 - 30 skew = 0 → already expired
		await service.getAccessToken(makeConn());
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-05: forceRefresh bypasses + replaces the cache', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn());
		await service.getAccessToken(makeConn(), { forceRefresh: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-06: config change (scope) busts the cache key', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn());
		await service.getAccessToken(makeConn({ oauthScope: 'read write' }));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-07: missing expires_in → default TTL (cached)', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(makeConn());
		await service.getAccessToken(makeConn());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('OAUTH-08: non-2xx surfaces error/error_description; not cached', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(
				jsonResponse({ error: 'invalid_client', error_description: 'bad creds' }, 401),
			);
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(/invalid_client/);
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(OAuthTokenError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-09: 200 without access_token → typed error', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ token_type: 'Bearer' }));
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(/access_token/);
	});

	it('OAUTH-10: timeout and network errors → reachable false', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }));
		const { diag: timed } = await service.fetchDiagnostics(makeConn());
		expect(timed).toMatchObject({ ok: false, reachable: false });
		expect(timed.error).toMatch(/timed out/);
		jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('boom'));
		const { diag: net } = await service.fetchDiagnostics(makeConn({ oauthScope: 'x' }));
		expect(net).toMatchObject({ ok: false, reachable: false });
	});

	it('OAUTH-13: TLS error is classified distinctly', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockRejectedValue(
				Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } }),
			);
		const { diag } = await service.fetchDiagnostics(makeConn());
		expect(diag.tlsError).toBe(true);
		expect(diag.error).toMatch(/TLS/i);
	});

	it('OAUTH-14: extra token params are sent in the body', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(
			makeConn({ oauthTokenRequestParams: { resource: 'r1' } as never }),
		);
		expect(bodyString(fetchMock.mock.calls[0])).toContain('resource=r1');
	});

	it('OAUTH-15: non-Bearer token_type rejected; absent accepted', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', token_type: 'mac' }));
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(/token_type/);
		jest.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({ access_token: 'AT2' }));
		await expect(service.getAccessToken(makeConn({ oauthScope: 'y' }))).resolves.toBe('AT2');
	});

	it('OAUTH-16: expires_in is clamped (floor / ceiling / non-numeric)', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', expires_in: 1 }));
		expect((await service.fetchDiagnostics(makeConn())).diag.expiresIn).toBe(30);
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', expires_in: 10_000_000 }));
		expect((await service.fetchDiagnostics(makeConn({ oauthScope: 'a' }))).diag.expiresIn).toBe(
			86400,
		);
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', expires_in: 'abc' }));
		expect((await service.fetchDiagnostics(makeConn({ oauthScope: 'b' }))).diag.expiresIn).toBe(
			3600,
		);
	});

	it('OAUTH-17: single-flight — concurrent calls trigger one POST', async () => {
		let resolveFetch: (r: Response) => void = () => undefined;
		const fetchMock = jest.spyOn(global, 'fetch').mockReturnValue(
			new Promise<Response>((r) => {
				resolveFetch = r;
			}),
		);
		const conn = makeConn();
		const p1 = service.getAccessToken(conn);
		const p2 = service.getAccessToken(conn);
		resolveFetch(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		const [a, b] = await Promise.all([p1, p2]);
		expect(a).toBe('AT');
		expect(b).toBe('AT');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('OAUTH-18: audits success and failure (no secret in metadata)', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', expires_in: 3600, scope: 'read' }));
		await service.getAccessToken(makeConn());
		const success = audit.recordSafe.mock.calls.find(
			(c) => c[0].event === 'api_connection_oauth_token_obtained',
		);
		expect(success).toBeDefined();
		expect(JSON.stringify(success![0])).not.toContain('super-secret');

		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401));
		await service.fetchDiagnostics(makeConn({ oauthScope: 'z' }));
		const failure = audit.recordSafe.mock.calls.find(
			(c) => c[0].event === 'api_connection_oauth_token_failed',
		);
		expect(failure).toBeDefined();
	});

	it('OAUTH-20: secret rotation re-POSTs (old token not reused)', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn({ oauthClientSecretEncrypted: 'old' }));
		await service.getAccessToken(makeConn({ oauthClientSecretEncrypted: 'new' }));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-22: thrown errors never contain the secret/token', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(
				jsonResponse({ error: 'bad', error_description: 'client_secret=super-secret leaked' }, 400),
			);
		const { diag } = await service.fetchDiagnostics(makeConn());
		expect(diag.error).not.toContain('super-secret');
	});

	it('OAUTH-23: getLastTokenAt null before, populated after success', async () => {
		expect(service.getLastTokenAt('c1')).toBeNull();
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn());
		expect(service.getLastTokenAt('c1')).not.toBeNull();
	});

	it('OAUTH-incomplete: missing config throws without a network call', async () => {
		const fetchMock = jest.spyOn(global, 'fetch');
		await expect(service.getAccessToken(makeConn({ oauthClientId: null }))).rejects.toThrow(
			/incomplete/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------------------
	// Extended edge cases
	// ---------------------------------------------------------------------------

	it('OAUTH-X01: scope/audience omitted from body when not configured', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(makeConn({ oauthScope: null, oauthAudience: null }));
		const body = bodyString(fetchMock.mock.calls[0]);
		expect(body).not.toContain('scope=');
		expect(body).not.toContain('audience=');
	});

	it('OAUTH-X02: token_type is case-insensitive ("BEARER" accepted)', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', token_type: 'BEARER' }));
		await expect(service.getAccessToken(makeConn())).resolves.toBe('AT');
	});

	it('OAUTH-X03: non-string access_token is rejected', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ access_token: 12345 }));
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(/access_token/);
	});

	it('OAUTH-X04: non-2xx with a non-JSON body still yields a clean HTTP error', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 400,
			json: async () => {
				throw new Error('not json');
			},
		} as unknown as Response);
		await expect(service.getAccessToken(makeConn())).rejects.toThrow(/HTTP 400/);
	});

	it('OAUTH-X05: 500 from token endpoint → reachable error', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 500));
		const { diag } = await service.fetchDiagnostics(makeConn());
		expect(diag).toMatchObject({ ok: false, reachable: true, statusCode: 500 });
	});

	it('OAUTH-X06: fetchDiagnostics caches the token → later getAccessToken reuses it', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		const conn = makeConn();
		await service.fetchDiagnostics(conn);
		const token = await service.getAccessToken(conn);
		expect(token).toBe('AT');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('OAUTH-X07: cache is isolated per connection id', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn({ id: 'c1' }));
		await service.getAccessToken(makeConn({ id: 'c2' }));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-X08: a failed exchange clears the in-flight slot (next call retries)', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await expect(service.getAccessToken(makeConn())).rejects.toBeDefined();
		await expect(service.getAccessToken(makeConn())).resolves.toBe('AT');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('OAUTH-X09: client_secret_basic encodes special characters correctly', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(
			makeConn({
				oauthClientAuthMethod: 'client_secret_basic',
				oauthClientId: 'id:with:colon',
				oauthClientSecretEncrypted: 'p@ss wörd',
			}),
		);
		expect(headerOf(fetchMock.mock.calls[0], 'Authorization')).toBe(
			`Basic ${Buffer.from('id:with:colon:p@ss wörd').toString('base64')}`,
		);
	});

	it('OAUTH-X10: getLastTokenAt is per-connection', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 3600 }));
		await service.getAccessToken(makeConn({ id: 'cX' }));
		expect(service.getLastTokenAt('cX')).not.toBeNull();
		expect(service.getLastTokenAt('cOther')).toBeNull();
	});

	it('OAUTH-X11: a mid-range expires_in is preserved (not clamped)', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', expires_in: 1234 }));
		expect((await service.fetchDiagnostics(makeConn())).diag.expiresIn).toBe(1234);
	});

	it('OAUTH-X12: grantedScope is echoed in diagnostics', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT', scope: 'read write' }));
		expect((await service.fetchDiagnostics(makeConn())).diag.grantedScope).toBe('read write');
	});

	it('OAUTH-X13: extra params are merged, with the grant fields still present', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ access_token: 'AT' }));
		await service.getAccessToken(
			makeConn({ oauthTokenRequestParams: { resource: 'r', tenant: 't' } as never }),
		);
		const body = bodyString(fetchMock.mock.calls[0]);
		expect(body).toContain('grant_type=client_credentials');
		expect(body).toContain('resource=r');
		expect(body).toContain('tenant=t');
	});

	it('OAUTH-X14: undecryptable stored secret throws a clear error, no network call', async () => {
		const failing = new OAuthTokenService(
			config,
			{
				encrypt: (s: string) => s,
				decrypt: () => {
					throw new Error('bad');
				},
			} as never,
			audit as never,
		);
		const fetchMock = jest.spyOn(global, 'fetch');
		await expect(failing.getAccessToken(makeConn())).rejects.toThrow(/could not be decrypted/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
