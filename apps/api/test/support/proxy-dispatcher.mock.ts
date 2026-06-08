import type { ProxyDispatcherService } from '../../src/sync/services/proxy-dispatcher.service';

/**
 * A no-op {@link ProxyDispatcherService} for unit tests: every connection resolves to a direct
 * connection (no dispatcher). Pass `proxied: true` to simulate an enabled proxy that returns a marker
 * dispatcher so wiring tests can assert a `dispatcher` reached `fetch`.
 */
export function fakeProxyDispatcher(
	opts: { proxied?: boolean; dispatcher?: unknown } = {},
): ProxyDispatcherService {
	const marker = opts.dispatcher ?? { [Symbol.for('nestidp.test.dispatcher')]: true };
	return {
		resolve: jest.fn(() => (opts.proxied ? (marker as never) : undefined)),
		isProxied: jest.fn(() => !!opts.proxied),
		proxyHostLabel: jest.fn(() => (opts.proxied ? 'proxy.example:8080' : null)),
		invalidate: jest.fn(),
		onModuleDestroy: jest.fn(async () => undefined),
	} as unknown as ProxyDispatcherService;
}
