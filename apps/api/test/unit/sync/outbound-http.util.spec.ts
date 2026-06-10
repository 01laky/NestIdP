import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	buildOutboundUrl,
	extractArrayAt,
	outboundFetch,
} from '@api/sync/utils/outbound-http.util';
import { ExternalApiValidationError } from '@api/sync/validators/external-api.validator';

/**
 * Prompt 39 D7: the util owns URL building, the bearer GET with per-caller timeout and optional
 * dispatcher passthrough, and envelope extraction. Proxy SELECTION (ProxyDispatcherService) and
 * TLS/proxy error CLASSIFICATION (proxy-error.util, tested in proxy-error.util.spec) deliberately
 * stay in the callers — they are not tested here.
 */
describe('outbound-http util (Prompt 39 D7)', () => {
	describe('buildOutboundUrl', () => {
		const onOriginViolation = (resolved: string) => new Error(`blocked: ${resolved}`);

		it('OUT-URL-01: joins base + path and appends query and extra params', () => {
			const url = buildOutboundUrl({
				baseUrl: 'https://API.example.com/idp/',
				path: 'users',
				queryParams: { page: '1' },
				extraParams: { limit: 50 },
				onOriginViolation,
			});
			expect(url).toBe('https://api.example.com/idp/users?page=1&limit=50');
		});

		it('OUT-URL-02: throws the per-caller injected error when an absolute path escapes the origin', () => {
			expect(() =>
				buildOutboundUrl({
					baseUrl: 'https://api.example.com',
					path: 'https://evil.example.net/users',
					onOriginViolation,
				}),
			).toThrow('blocked: https://evil.example.net/users');
		});

		it('OUT-URL-03: a protocol-relative path is also caught as an origin violation', () => {
			expect(() =>
				buildOutboundUrl({
					baseUrl: 'https://api.example.com',
					path: '//evil.example.net/users',
					onOriginViolation,
				}),
			).toThrow('blocked: https://evil.example.net/users');
		});
	});

	describe('outboundFetch', () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it('OUT-FETCH-01: sends bearer + accept + caller headers and passes the dispatcher through', async () => {
			const fetchSpy = jest
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response('[]') as never);
			const dispatcher = { marker: 'proxy-dispatcher' } as never;

			await outboundFetch({
				url: 'https://api.example.com/users',
				bearerToken: 'tok-1',
				headers: { 'X-Caller': 'test' },
				timeoutMs: 1000,
				dispatcher,
			});

			const [url, init] = fetchSpy.mock.calls[0] as [
				string,
				RequestInit & { dispatcher?: unknown },
			];
			expect(url).toBe('https://api.example.com/users');
			expect(init.method).toBe('GET');
			expect(init.headers).toEqual({
				'X-Caller': 'test',
				Authorization: 'Bearer tok-1',
				Accept: 'application/json',
			});
			expect(init.signal).toBeInstanceOf(AbortSignal);
			expect(init.dispatcher).toBe(dispatcher);
		});

		it('OUT-FETCH-02: omits the dispatcher key entirely for direct (non-proxied) connections', async () => {
			const fetchSpy = jest
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response('[]') as never);

			await outboundFetch({
				url: 'https://api.example.com/users',
				bearerToken: 'tok-1',
				headers: {},
				timeoutMs: 1000,
			});

			const init = fetchSpy.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
			expect('dispatcher' in init).toBe(false);
		});

		it('OUT-FETCH-03: aborts with TimeoutError when the server hangs past timeoutMs', async () => {
			// A real socket that accepts the request and never responds.
			const server = createServer(() => undefined);
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const { port } = server.address() as AddressInfo;
			try {
				await expect(
					outboundFetch({
						url: `http://127.0.0.1:${port}/users`,
						bearerToken: 'tok-1',
						headers: {},
						timeoutMs: 50,
					}),
				).rejects.toMatchObject({ name: 'TimeoutError' });
			} finally {
				server.closeAllConnections();
				await new Promise((resolve) => server.close(resolve));
			}
		});
	});

	describe('extractArrayAt', () => {
		it('OUT-EXTRACT-01: returns the array found at the response root path', () => {
			const body = { data: { users: [{ id: 'u1' }] } };
			expect(extractArrayAt(body, 'data.users', 'must be array')).toEqual([{ id: 'u1' }]);
		});

		it('OUT-EXTRACT-02: returns the body itself when no response root is configured', () => {
			expect(extractArrayAt([1, 2], '', 'must be array')).toEqual([1, 2]);
		});

		it('OUT-EXTRACT-03: a non-array at the root path throws the rooted message', () => {
			expect(() => extractArrayAt({ data: { users: 'nope' } }, 'data.users', 'unused')).toThrow(
				new ExternalApiValidationError('Response did not contain an array at "data.users"'),
			);
		});

		it('OUT-EXTRACT-04: a rootless non-array body throws the caller-specific wording', () => {
			expect(() =>
				extractArrayAt({ users: [] }, '', 'Users response must be a JSON array'),
			).toThrow(new ExternalApiValidationError('Users response must be a JSON array'));
		});
	});
});
