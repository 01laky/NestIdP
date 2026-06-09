import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ApiConnection } from '@prisma/client';
import type { Dispatcher } from 'undici';
import { ProxyAgent } from 'undici';
import { hostBypassesProxy } from '@nestidp/shared';
import { boundedInt } from '../../common/config/bounded-int.util';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';

export const DEFAULT_PROXY_CONNECT_TIMEOUT_MS = 5_000;

interface CachedAgent {
	hash: string;
	agent: ProxyAgent;
}

/**
 * Resolves a per-connection `undici` `ProxyAgent` to use as a `fetch` dispatcher (Prompt 33). Returns
 * `undefined` (direct) when proxy is off, no proxy URL is set, or the target matches `noProxyHosts`.
 *
 * One `ProxyAgent` is cached per connection, keyed by a hash of its proxy config; a config change builds
 * a fresh agent and closes the superseded one. Agents are created lazily on first resolve — never at
 * module init — so a bad stored `proxyUrl` can never block app startup. All agents close on shutdown.
 */
@Injectable()
export class ProxyDispatcherService implements OnModuleDestroy {
	private readonly logger = new Logger(ProxyDispatcherService.name);
	private readonly agents = new Map<string, CachedAgent>();

	constructor(
		private readonly configService: ConfigService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
	) {}

	/**
	 * Resolve a dispatcher for an outbound call to `targetUrl` on behalf of `connection`, or `undefined`
	 * for a direct connection. Throws only if a configured proxy password cannot be decrypted.
	 */
	resolve(connection: ApiConnection, targetUrl: string): Dispatcher | undefined {
		if (!this.isProxied(connection, targetUrl)) {
			return undefined;
		}
		return this.getOrBuildAgent(connection);
	}

	/** True when an outbound call to `targetUrl` would traverse the proxy (off / bypassed → false). */
	isProxied(connection: ApiConnection, targetUrl: string): boolean {
		if (connection.isLocalDirectory || !connection.proxyEnabled || !connection.proxyUrl) {
			return false;
		}
		return !hostBypassesProxy(targetUrl, connection.noProxyHosts);
	}

	/** Proxy `host:port` for audit/diagnostics (never credentials), or null when none configured. */
	proxyHostLabel(connection: ApiConnection): string | null {
		if (!connection.proxyUrl) {
			return null;
		}
		try {
			return new URL(connection.proxyUrl).host;
		} catch {
			return null;
		}
	}

	/** Close and evict the cached agent for a connection (called from update/delete). */
	invalidate(connectionId: string): void {
		const cached = this.agents.get(connectionId);
		if (cached) {
			this.agents.delete(connectionId);
			void this.safeClose(cached.agent);
		}
	}

	async onModuleDestroy(): Promise<void> {
		const closing = [...this.agents.values()].map((c) => this.safeClose(c.agent));
		this.agents.clear();
		await Promise.allSettled(closing);
	}

	private getOrBuildAgent(connection: ApiConnection): ProxyAgent {
		const hash = this.configHash(connection);
		const cached = this.agents.get(connection.id);
		if (cached && cached.hash === hash) {
			return cached.agent;
		}
		if (cached) {
			void this.safeClose(cached.agent);
		}
		const agent = this.buildAgent(connection);
		this.agents.set(connection.id, { hash, agent });
		return agent;
	}

	private buildAgent(connection: ApiConnection): ProxyAgent {
		const options: ProxyAgent.Options = {
			uri: connection.proxyUrl as string,
			connectTimeout: this.connectTimeoutMs(),
		};
		if (connection.proxyUsername) {
			let password = '';
			if (connection.proxyPasswordEncrypted) {
				password = this.encryption.decrypt(connection.proxyPasswordEncrypted);
			}
			options.token = `Basic ${Buffer.from(`${connection.proxyUsername}:${password}`).toString('base64')}`;
		}
		return new ProxyAgent(options);
	}

	private configHash(connection: ApiConnection): string {
		// proxyPasswordEncrypted is included so rotating the password rebuilds the agent. It is the
		// ciphertext (never plaintext) — safe to hash.
		const material = JSON.stringify({
			url: connection.proxyUrl,
			username: connection.proxyUsername,
			password: connection.proxyPasswordEncrypted,
			noProxy: connection.noProxyHosts,
			connectTimeout: this.connectTimeoutMs(),
		});
		return createHash('sha256').update(material).digest('hex');
	}

	private async safeClose(agent: ProxyAgent): Promise<void> {
		try {
			await agent.close();
		} catch (error) {
			this.logger.warn(
				`Failed to close a ProxyAgent: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	}

	private connectTimeoutMs(): number {
		return boundedInt(
			this.configService.get<number | string>('PROXY_CONNECT_TIMEOUT_MS'),
			DEFAULT_PROXY_CONNECT_TIMEOUT_MS,
			100,
			60_000,
		);
	}
}
