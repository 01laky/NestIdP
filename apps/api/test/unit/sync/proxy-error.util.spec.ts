import { annotateIfProxied, classifyProxyError } from '@api/sync/utils/proxy-error.util';

/** Build a nested error chain like undici/fetch produces (outer TypeError → cause → cause). */
function chained(...nodes: Array<{ name?: string; code?: string; message?: string }>): Error {
	let cause: unknown = undefined;
	for (let i = nodes.length - 1; i >= 0; i--) {
		const n = nodes[i];
		const e = new Error(n.message ?? 'err') as Error & { code?: string; cause?: unknown };
		if (n.name) e.name = n.name;
		if (n.code) e.code = n.code;
		if (cause) e.cause = cause;
		cause = e;
	}
	return cause as Error;
}

describe('classifyProxyError (PROXY-ERR-01..05)', () => {
	it('PROXY-ERR-01: proxy HTTP 407 → auth_failed', () => {
		const err = chained(
			{ name: 'TypeError', message: 'fetch failed' },
			{ message: 'Request was cancelled.' },
			{
				name: 'AbortError',
				code: 'UND_ERR_ABORTED',
				message: 'Proxy response (407) !== 200 when HTTP Tunneling',
			},
		);
		const r = classifyProxyError(err, { proxied: true });
		expect(r.status).toBe('auth_failed');
		expect(r.message).toMatch(/407/);
	});

	it('PROXY-ERR-02: proxy ECONNREFUSED/timeout → unreachable', () => {
		const refused = chained(
			{ name: 'TypeError', message: 'fetch failed' },
			{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
		);
		expect(classifyProxyError(refused, { proxied: true }).status).toBe('unreachable');

		const dns = chained({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND proxy' });
		expect(classifyProxyError(dns, { proxied: true }).status).toBe('unreachable');

		const timeout = chained({ name: 'TimeoutError', message: 'timed out' });
		expect(classifyProxyError(timeout, { proxied: true }).status).toBe('unreachable');
	});

	it('PROXY-ERR-03: proxy reachable but CONNECT tunnel refused (non-407) → tunnel_failed', () => {
		const err = chained(
			{ name: 'TypeError', message: 'fetch failed' },
			{
				name: 'AbortError',
				code: 'UND_ERR_ABORTED',
				message: 'Proxy response (502) !== 200 when HTTP Tunneling',
			},
		);
		const r = classifyProxyError(err, { proxied: true });
		expect(r.status).toBe('tunnel_failed');
		expect(r.message).toMatch(/502/);
	});

	it('PROXY-ERR-04: certificate failure → tls_error', () => {
		const err = chained(
			{ name: 'TypeError', message: 'fetch failed' },
			{ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' },
		);
		expect(classifyProxyError(err, { proxied: true }).status).toBe('tls_error');
	});

	it('PROXY-ERR-05: proxied unknown → unreachable; direct → target_error (unchanged wording)', () => {
		const unknown = chained({ message: 'something odd' });
		expect(classifyProxyError(unknown, { proxied: true }).status).toBe('unreachable');
		const direct = classifyProxyError(chained({ code: 'ECONNREFUSED' }), { proxied: false });
		expect(direct.status).toBe('target_error');
		expect(direct.message).toMatch(/target/);
	});
});

describe('annotateIfProxied', () => {
	it('leaves the message unchanged when not proxied', () => {
		expect(annotateIfProxied('Could not reach identity API', new Error('x'), false)).toBe(
			'Could not reach identity API',
		);
	});

	it('adds a proxy hint when proxied', () => {
		const msg = annotateIfProxied(
			'Could not reach identity API',
			chained({ code: 'ECONNREFUSED' }),
			true,
		);
		expect(msg).toMatch(/proxy/i);
	});

	it('names a 407 distinctly', () => {
		const err = chained({
			name: 'AbortError',
			code: 'UND_ERR_ABORTED',
			message: 'Proxy response (407) !== 200 when HTTP Tunneling',
		});
		expect(annotateIfProxied('token endpoint: could not be reached', err, true)).toMatch(
			/rejected credentials/i,
		);
	});
});

describe('classifyProxyError — extended', () => {
	it('PROXY-ERR-EXT-01: a CONNECT 407 anywhere in the chain wins over a co-present connect code', () => {
		const err = chained(
			{ name: 'TypeError', message: 'fetch failed' },
			{ code: 'ECONNRESET', message: 'socket hang up' },
			{
				name: 'AbortError',
				code: 'UND_ERR_ABORTED',
				message: 'Proxy response (407) !== 200 when HTTP Tunneling',
			},
		);
		expect(classifyProxyError(err, { proxied: true }).status).toBe('auth_failed');
	});

	it('PROXY-ERR-EXT-02: a non-407 CONNECT status (403) → tunnel_failed', () => {
		const err = chained({
			name: 'AbortError',
			message: 'Proxy response (403) !== 200 when HTTP Tunneling',
		});
		const r = classifyProxyError(err, { proxied: true });
		expect(r.status).toBe('tunnel_failed');
		expect(r.message).toMatch(/403/);
	});

	it('PROXY-ERR-EXT-03: every recognised connect code maps to unreachable when proxied', () => {
		for (const code of [
			'ECONNREFUSED',
			'ENOTFOUND',
			'EAI_AGAIN',
			'ETIMEDOUT',
			'ECONNRESET',
			'EHOSTUNREACH',
			'ENETUNREACH',
			'UND_ERR_CONNECT_TIMEOUT',
		]) {
			expect(classifyProxyError(chained({ code }), { proxied: true }).status).toBe('unreachable');
		}
	});

	it('PROXY-ERR-EXT-04: a TLS code wins over an unknown message', () => {
		const err = chained(
			{ message: 'fetch failed' },
			{ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self signed' },
		);
		expect(classifyProxyError(err, { proxied: true }).status).toBe('tls_error');
	});

	it('PROXY-ERR-EXT-05: tolerates non-Error inputs (string / null / number / plain object)', () => {
		for (const input of ['boom', null, undefined, 42, { nope: true }]) {
			const r = classifyProxyError(input, { proxied: true });
			expect(r.status).toBe('unreachable');
			expect(typeof r.message).toBe('string');
		}
	});

	it('PROXY-ERR-EXT-06: direct (non-proxied) never returns a proxy-specific status', () => {
		const tunnel = chained({ message: 'Proxy response (407) !== 200 when HTTP Tunneling' });
		// not proxied → the 407 parser is skipped; falls through to target_error
		expect(classifyProxyError(tunnel, { proxied: false }).status).toBe('target_error');
		expect(classifyProxyError(chained({ name: 'TimeoutError' }), { proxied: false }).status).toBe(
			'target_error',
		);
	});

	it('PROXY-ERR-EXT-07: a deep cause chain is still searched (within the bound)', () => {
		const err = chained(
			{ message: 'a' },
			{ message: 'b' },
			{ message: 'c' },
			{ message: 'd' },
			{ code: 'ECONNREFUSED', message: 'refused' },
		);
		expect(classifyProxyError(err, { proxied: true }).status).toBe('unreachable');
	});

	it('PROXY-ERR-EXT-08: a self-referential cause chain does not hang', () => {
		const a = new Error('loop') as Error & { code?: string; cause?: unknown };
		a.code = 'ECONNREFUSED';
		a.cause = a;
		expect(classifyProxyError(a, { proxied: true }).status).toBe('unreachable');
	});

	it('PROXY-ERR-EXT-09: timeout maps to target_error when not proxied, unreachable when proxied', () => {
		const t = chained({ name: 'TimeoutError', message: 'timed out' });
		expect(classifyProxyError(t, { proxied: true }).status).toBe('unreachable');
		expect(classifyProxyError(t, { proxied: false }).status).toBe('target_error');
	});
});

describe('annotateIfProxied — extended', () => {
	it('PROXY-ERR-EXT-10: tunnel failure is annotated distinctly from a plain proxy hint', () => {
		const tunnel = chained({ message: 'Proxy response (502) !== 200 when HTTP Tunneling' });
		expect(annotateIfProxied('base', tunnel, true)).toMatch(/tunnel/i);
	});

	it('PROXY-ERR-EXT-11: an unreachable proxy is annotated as such', () => {
		expect(annotateIfProxied('base', chained({ code: 'ENOTFOUND' }), true)).toMatch(
			/proxy unreachable/i,
		);
	});

	it('PROXY-ERR-EXT-12: a tls error falls back to the generic proxy hint', () => {
		expect(annotateIfProxied('base', chained({ code: 'CERT_HAS_EXPIRED' }), true)).toMatch(
			/via proxy/i,
		);
	});
});
