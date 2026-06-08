import { ConfigService } from '@nestjs/config';
import type { ApiConnection } from '@prisma/client';
import { ProxyAgent } from 'undici';
import { ProxyDispatcherService } from '@api/sync/services/proxy-dispatcher.service';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';

function conn(overrides: Partial<ApiConnection> = {}): ApiConnection {
	return {
		id: 'c1',
		name: 'API',
		baseUrl: 'https://identity.example.com',
		isLocalDirectory: false,
		proxyEnabled: true,
		proxyUrl: 'http://proxy.corp.example:8080',
		proxyUsername: null,
		proxyPasswordEncrypted: null,
		noProxyHosts: null,
		...overrides,
	} as unknown as ApiConnection;
}

describe('ProxyDispatcherService', () => {
	let config: ConfigService;
	let encryption: CredentialsEncryptionPort & { decrypt: jest.Mock };
	let service: ProxyDispatcherService;
	let closeSpy: jest.SpyInstance;

	beforeEach(() => {
		config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
		encryption = {
			encrypt: jest.fn((s: string) => `enc:${s}`),
			decrypt: jest.fn((s: string) => s.replace(/^enc:/, '')),
		};
		service = new ProxyDispatcherService(config, encryption);
		closeSpy = jest.spyOn(ProxyAgent.prototype, 'close').mockResolvedValue(undefined);
	});

	afterEach(() => {
		closeSpy.mockRestore();
	});

	it('PROXY-DISP-01: proxy disabled → undefined (direct)', () => {
		expect(
			service.resolve(conn({ proxyEnabled: false }), 'https://identity.example.com'),
		).toBeUndefined();
		expect(
			service.resolve(conn({ proxyUrl: null }), 'https://identity.example.com'),
		).toBeUndefined();
		expect(
			service.resolve(conn({ isLocalDirectory: true }), 'https://identity.example.com'),
		).toBeUndefined();
	});

	it('PROXY-DISP-02: proxy enabled, no matching no-proxy → returns a ProxyAgent', () => {
		const d = service.resolve(conn(), 'https://identity.example.com');
		expect(d).toBeInstanceOf(ProxyAgent);
	});

	it('PROXY-DISP-03: target matches noProxyHosts → undefined (direct)', () => {
		const d = service.resolve(
			conn({ noProxyHosts: '.example.com' }),
			'https://identity.example.com/users',
		);
		expect(d).toBeUndefined();
	});

	it('PROXY-DISP-04: Basic auth decrypts the password when username is set; none when empty', () => {
		service.resolve(
			conn({ proxyUsername: 'u', proxyPasswordEncrypted: 'enc:secret' }),
			'https://x.example',
		);
		expect(encryption.decrypt).toHaveBeenCalledWith('enc:secret');

		encryption.decrypt.mockClear();
		service.resolve(conn({ id: 'c2', proxyUsername: null }), 'https://x.example');
		expect(encryption.decrypt).not.toHaveBeenCalled();
	});

	it('PROXY-DISP-05a: same config → same cached instance', () => {
		const c = conn();
		const a = service.resolve(c, 'https://identity.example.com');
		const b = service.resolve(c, 'https://identity.example.com');
		expect(a).toBe(b);
	});

	it('PROXY-DISP-05b: config change rebuilds + closes the superseded agent', () => {
		const a = service.resolve(conn(), 'https://identity.example.com');
		const b = service.resolve(
			conn({ proxyUrl: 'http://proxy2.corp.example:8080' }),
			'https://identity.example.com',
		);
		expect(a).not.toBe(b);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it('PROXY-DISP-05c: invalidate closes + evicts; onModuleDestroy closes all', async () => {
		service.resolve(conn({ id: 'a' }), 'https://identity.example.com');
		service.resolve(conn({ id: 'b' }), 'https://identity.example.com');
		service.invalidate('a');
		expect(closeSpy).toHaveBeenCalledTimes(1);
		await service.onModuleDestroy();
		expect(closeSpy).toHaveBeenCalledTimes(2);
	});

	it('PROXY-DISP-06: no agent is built at construction (lazy); bad URL only throws on resolve', () => {
		const lazy = new ProxyDispatcherService(config, encryption);
		// constructing the service touched no proxy config
		expect(() => new ProxyDispatcherService(config, encryption)).not.toThrow();
		// a malformed proxy URL surfaces only when an outbound call resolves it — never at boot
		expect(() => lazy.resolve(conn({ proxyUrl: 'http://' }), 'https://x.example')).toThrow();
	});

	it('isProxied reflects enabled + bypass', () => {
		expect(service.isProxied(conn(), 'https://identity.example.com')).toBe(true);
		expect(service.isProxied(conn({ proxyEnabled: false }), 'https://x.example')).toBe(false);
		expect(service.isProxied(conn({ noProxyHosts: '*' }), 'https://x.example')).toBe(false);
	});

	it('proxyHostLabel returns host:port, never credentials', () => {
		expect(service.proxyHostLabel(conn())).toBe('proxy.corp.example:8080');
		expect(service.proxyHostLabel(conn({ proxyUrl: null }))).toBeNull();
	});

	// --- extended edge cases ---------------------------------------------------------------------

	it('PROXY-DISP-EXT-01: resolves per target — same connection, token URL bypassed but base proxied', () => {
		const c = conn({ noProxyHosts: '.login.example' });
		expect(service.resolve(c, 'https://identity.example.com/users')).toBeInstanceOf(ProxyAgent);
		expect(service.resolve(c, 'https://api.login.example/token')).toBeUndefined();
	});

	it('PROXY-DISP-EXT-02: caches independently per connection id', () => {
		const a = service.resolve(conn({ id: 'a' }), 'https://identity.example.com');
		const b = service.resolve(conn({ id: 'b' }), 'https://identity.example.com');
		expect(a).not.toBe(b);
		expect(a).toBeInstanceOf(ProxyAgent);
		expect(b).toBeInstanceOf(ProxyAgent);
	});

	it('PROXY-DISP-EXT-03: a wildcard noProxyHosts makes resolve direct', () => {
		expect(
			service.resolve(conn({ noProxyHosts: '*' }), 'https://identity.example.com'),
		).toBeUndefined();
	});

	it('PROXY-DISP-EXT-04: a CIDR noProxyHosts makes an IP-literal target direct', () => {
		expect(
			service.resolve(conn({ noProxyHosts: '10.0.0.0/8' }), 'http://10.1.2.3:9000/users'),
		).toBeUndefined();
		expect(
			service.resolve(conn({ noProxyHosts: '10.0.0.0/8' }), 'http://11.1.2.3:9000/users'),
		).toBeInstanceOf(ProxyAgent);
	});

	it('PROXY-DISP-EXT-05: a decrypt failure propagates (caller surfaces it as a clear error)', () => {
		encryption.decrypt.mockImplementation(() => {
			throw new Error('bad key');
		});
		expect(() =>
			service.resolve(
				conn({ proxyUsername: 'u', proxyPasswordEncrypted: 'enc:secret' }),
				'https://x.example',
			),
		).toThrow(/bad key/);
	});

	it('PROXY-DISP-EXT-06: invalidate on an unknown id is a no-op (no throw, no close)', () => {
		expect(() => service.invalidate('never-cached')).not.toThrow();
		expect(closeSpy).not.toHaveBeenCalled();
	});

	it('PROXY-DISP-EXT-07: onModuleDestroy with no agents resolves cleanly', async () => {
		await expect(service.onModuleDestroy()).resolves.toBeUndefined();
		expect(closeSpy).not.toHaveBeenCalled();
	});

	it('PROXY-DISP-EXT-08: a username-only change rebuilds the agent (auth is part of the cache key)', () => {
		const a = service.resolve(conn({ proxyUsername: null }), 'https://identity.example.com');
		const b = service.resolve(
			conn({ proxyUsername: 'u', proxyPasswordEncrypted: 'enc:p' }),
			'https://identity.example.com',
		);
		expect(a).not.toBe(b);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it('PROXY-DISP-EXT-09: a noProxyHosts change rebuilds the agent', () => {
		const a = service.resolve(conn(), 'https://identity.example.com');
		const b = service.resolve(
			conn({ noProxyHosts: '.other.example' }),
			'https://identity.example.com',
		);
		expect(a).not.toBe(b);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it('PROXY-DISP-EXT-10: a bounded PROXY_CONNECT_TIMEOUT_MS env override is honoured in the cache key', () => {
		(config.get as jest.Mock).mockImplementation((k: string) =>
			k === 'PROXY_CONNECT_TIMEOUT_MS' ? 1234 : undefined,
		);
		const svc = new ProxyDispatcherService(config, encryption);
		// building does not throw and a valid agent is produced
		expect(svc.resolve(conn(), 'https://identity.example.com')).toBeInstanceOf(ProxyAgent);
		// an out-of-range value falls back silently
		(config.get as jest.Mock).mockImplementation((k: string) =>
			k === 'PROXY_CONNECT_TIMEOUT_MS' ? 10 : undefined,
		);
		const svc2 = new ProxyDispatcherService(config, encryption);
		expect(svc2.resolve(conn(), 'https://identity.example.com')).toBeInstanceOf(ProxyAgent);
	});

	it('PROXY-DISP-EXT-11: an empty stored password with a username still builds (Basic user:)', () => {
		const d = service.resolve(
			conn({ proxyUsername: 'u', proxyPasswordEncrypted: null }),
			'https://x.example',
		);
		expect(d).toBeInstanceOf(ProxyAgent);
		// no decrypt attempted when there is no ciphertext
		expect(encryption.decrypt).not.toHaveBeenCalled();
	});
});
