import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { boundedInt as boundedIntFromRaw } from '../../common/config/bounded-int.util';
import type { ApiConnection } from '@prisma/client';
import {
	OAUTH_DEFAULT_CLIENT_AUTH_METHOD,
	type OAuthClientAuthMethod,
	type OAuthTokenDiagnosticsDto,
} from '@nestidp/shared';
import type { Dispatcher } from 'undici';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { redactSecrets } from '../../encryption/utils/redact-secret.util';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { ProxyDispatcherService } from './proxy-dispatcher.service';
import { annotateIfProxied } from '../utils/proxy-error.util';

export const DEFAULT_OAUTH_TOKEN_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_OAUTH_TOKEN_REFRESH_SKEW_SECONDS = 30;
export const DEFAULT_OAUTH_TOKEN_MIN_TTL_SECONDS = 30;
export const DEFAULT_OAUTH_TOKEN_MAX_TTL_SECONDS = 86_400;
export const OAUTH_FALLBACK_TTL_SECONDS = 3600;

const TLS_ERROR_CODES = new Set([
	'CERT_HAS_EXPIRED',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'ERR_TLS_CERT_ALTNAME_INVALID',
	'CERT_UNTRUSTED',
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

export class OAuthTokenError extends Error {
	constructor(
		message: string,
		public readonly options: {
			statusCode?: number;
			reachable?: boolean;
			tlsError?: boolean;
			oauthError?: string;
		} = {},
	) {
		super(message);
		this.name = 'OAuthTokenError';
	}
}

interface ResolvedOAuthConfig {
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	scope: string | null;
	audience: string | null;
	authMethod: OAuthClientAuthMethod;
	params: Record<string, string>;
}

interface CacheEntry {
	token: string;
	expiresAt: number;
}

interface ExchangeResult {
	token: string;
	tokenType?: string;
	expiresIn: number;
	grantedScope?: string;
	statusCode: number;
}

@Injectable()
export class OAuthTokenService {
	private readonly logger = new Logger(OAuthTokenService.name);
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, Promise<string>>();
	private readonly lastTokenAt = new Map<string, number>();

	constructor(
		private readonly configService: ConfigService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: AuditPersistenceService,
		private readonly proxyDispatcher: ProxyDispatcherService,
	) {}

	getLastTokenAt(connectionId: string): string | null {
		const ms = this.lastTokenAt.get(connectionId);
		return ms ? new Date(ms).toISOString() : null;
	}

	/**
	 * Drop every cached token, in-flight exchange and last-token timestamp for a connection (§5.B13).
	 * Call when the connection is deleted or its OAuth credentials change — otherwise a deleted/rotated
	 * connection's entries leak forever and `getLastTokenAt` can report a stale time for a reused id.
	 */
	invalidate(connectionId: string): void {
		const prefix = `${connectionId}:`;
		for (const key of [...this.cache.keys()]) {
			if (key.startsWith(prefix)) {
				this.cache.delete(key);
			}
		}
		for (const key of [...this.inflight.keys()]) {
			if (key.startsWith(prefix)) {
				this.inflight.delete(key);
			}
		}
		this.lastTokenAt.delete(connectionId);
	}

	/** Resolve a valid access token, using the cache + single-flight; throws OAuthTokenError on failure. */
	async getAccessToken(
		connection: ApiConnection,
		opts?: { forceRefresh?: boolean },
	): Promise<string> {
		const cfg = this.resolveConfig(connection);
		const key = this.cacheKey(connection.id, cfg);

		if (opts?.forceRefresh) {
			this.cache.delete(key);
		} else {
			const cached = this.cache.get(key);
			if (cached && Date.now() < cached.expiresAt) {
				return cached.token;
			}
			const existing = this.inflight.get(key);
			if (existing) {
				return existing;
			}
		}

		const promise = this.exchangeAndCache(connection, cfg, key)
			.then((r) => r.token)
			.finally(() => {
				if (this.inflight.get(key) === promise) {
					this.inflight.delete(key);
				}
			});
		this.inflight.set(key, promise);
		return promise;
	}

	/** Perform a token exchange for diagnostics (Test token / Test connection). Never throws. */
	async fetchDiagnostics(
		connection: ApiConnection,
	): Promise<{ diag: OAuthTokenDiagnosticsDto; token?: string }> {
		let cfg: ResolvedOAuthConfig;
		try {
			cfg = this.resolveConfig(connection);
		} catch (error) {
			return { diag: this.errorToDiag(error) };
		}
		const key = this.cacheKey(connection.id, cfg);
		try {
			const result = await this.exchangeAndCache(connection, cfg, key);
			return {
				token: result.token,
				diag: {
					ok: true,
					reachable: true,
					statusCode: result.statusCode,
					tokenType: result.tokenType,
					expiresIn: result.expiresIn,
					grantedScope: result.grantedScope,
				},
			};
		} catch (error) {
			return { diag: this.errorToDiag(error) };
		}
	}

	private async exchangeAndCache(
		connection: ApiConnection,
		cfg: ResolvedOAuthConfig,
		key: string,
	): Promise<ExchangeResult> {
		let result: ExchangeResult;
		try {
			// Route the token exchange through the proxy when configured for this connection. The
			// no-proxy list is evaluated against the token URL (which may differ from baseUrl's host).
			const dispatcher = this.proxyDispatcher.resolve(connection, cfg.tokenUrl);
			result = await this.exchange(
				cfg,
				dispatcher,
				this.proxyDispatcher.isProxied(connection, cfg.tokenUrl),
			);
		} catch (error) {
			this.auditFailure(connection.id, error);
			throw error;
		}
		const skew = this.refreshSkewSeconds();
		const effectiveTtlMs = Math.max(0, result.expiresIn - skew) * 1000;
		this.cache.set(key, { token: result.token, expiresAt: Date.now() + effectiveTtlMs });
		this.lastTokenAt.set(connection.id, Date.now());
		this.auditSuccess(connection.id, result);
		return result;
	}

	private async exchange(
		cfg: ResolvedOAuthConfig,
		dispatcher?: Dispatcher,
		proxied = false,
	): Promise<ExchangeResult> {
		const form = new URLSearchParams();
		form.set('grant_type', 'client_credentials');
		if (cfg.authMethod === 'client_secret_post') {
			form.set('client_id', cfg.clientId);
			form.set('client_secret', cfg.clientSecret);
		}
		if (cfg.scope) {
			form.set('scope', cfg.scope);
		}
		if (cfg.audience) {
			form.set('audience', cfg.audience);
		}
		for (const [k, v] of Object.entries(cfg.params)) {
			form.set(k, v);
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		};
		if (cfg.authMethod === 'client_secret_basic') {
			headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
		}

		let response: Response;
		try {
			response = await fetch(cfg.tokenUrl, {
				method: 'POST',
				headers,
				body: form,
				signal: AbortSignal.timeout(this.httpTimeoutMs()),
				...(dispatcher ? { dispatcher } : {}),
			} as RequestInit & { dispatcher?: Dispatcher });
		} catch (error) {
			throw this.networkError(error, proxied);
		}

		let json: Record<string, unknown> | null = null;
		try {
			json = (await response.json()) as Record<string, unknown>;
		} catch {
			json = null;
		}

		if (response.status < 200 || response.status >= 300) {
			const oauthError = typeof json?.error === 'string' ? json.error : undefined;
			const desc = typeof json?.error_description === 'string' ? json.error_description : undefined;
			const detail = oauthError ? ` (${oauthError}${desc ? `: ${desc}` : ''})` : '';
			throw new OAuthTokenError(`token endpoint: HTTP ${response.status}${detail}`, {
				statusCode: response.status,
				reachable: true,
				oauthError,
			});
		}

		const token = json?.access_token;
		if (typeof token !== 'string' || token.length === 0) {
			throw new OAuthTokenError('token endpoint: response did not contain an access_token', {
				statusCode: response.status,
				reachable: true,
			});
		}
		const tokenType =
			typeof json?.token_type === 'string' ? (json.token_type as string) : undefined;
		if (tokenType && tokenType.toLowerCase() !== 'bearer') {
			throw new OAuthTokenError(
				`token endpoint: unsupported token_type "${tokenType}" (expected Bearer)`,
				{
					statusCode: response.status,
					reachable: true,
				},
			);
		}
		return {
			token,
			tokenType,
			expiresIn: this.clampTtl(json?.expires_in),
			grantedScope: typeof json?.scope === 'string' ? (json.scope as string) : undefined,
			statusCode: response.status,
		};
	}

	private networkError(error: unknown, proxied = false): OAuthTokenError {
		if (error instanceof Error && error.name === 'TimeoutError') {
			return new OAuthTokenError(
				annotateIfProxied('token endpoint: request timed out', error, proxied),
				{ reachable: false },
			);
		}
		const code = this.extractErrorCode(error);
		if (code && TLS_ERROR_CODES.has(code)) {
			return new OAuthTokenError(`token endpoint TLS error: ${code}`, {
				reachable: false,
				tlsError: true,
			});
		}
		return new OAuthTokenError(
			annotateIfProxied('token endpoint: could not be reached', error, proxied),
			{ reachable: false },
		);
	}

	private extractErrorCode(error: unknown): string | undefined {
		if (error && typeof error === 'object') {
			const e = error as { code?: unknown; cause?: { code?: unknown } };
			if (typeof e.code === 'string') {
				return e.code;
			}
			if (e.cause && typeof e.cause.code === 'string') {
				return e.cause.code;
			}
		}
		return undefined;
	}

	private clampTtl(raw: unknown): number {
		const n = Number(raw);
		const base = Number.isFinite(n) && n > 0 ? n : OAUTH_FALLBACK_TTL_SECONDS;
		return Math.max(this.minTtlSeconds(), Math.min(this.maxTtlSeconds(), Math.floor(base)));
	}

	private resolveConfig(connection: ApiConnection): ResolvedOAuthConfig {
		const tokenUrl = connection.oauthTokenUrl?.trim();
		const clientId = connection.oauthClientId?.trim();
		if (!tokenUrl || !clientId || !connection.oauthClientSecretEncrypted) {
			throw new OAuthTokenError(
				'OAuth configuration is incomplete (token URL, client id, or secret missing)',
			);
		}
		let clientSecret: string;
		try {
			clientSecret = this.encryption.decrypt(connection.oauthClientSecretEncrypted);
		} catch {
			throw new OAuthTokenError('Stored OAuth client secret could not be decrypted');
		}
		const authMethod: OAuthClientAuthMethod =
			connection.oauthClientAuthMethod === 'client_secret_basic'
				? 'client_secret_basic'
				: OAUTH_DEFAULT_CLIENT_AUTH_METHOD;
		const params =
			connection.oauthTokenRequestParams && typeof connection.oauthTokenRequestParams === 'object'
				? (connection.oauthTokenRequestParams as Record<string, string>)
				: {};
		return {
			tokenUrl,
			clientId,
			clientSecret,
			scope: connection.oauthScope?.trim() || null,
			audience: connection.oauthAudience?.trim() || null,
			authMethod,
			params,
		};
	}

	private cacheKey(connectionId: string, cfg: ResolvedOAuthConfig): string {
		const secretHash = createHash('sha256').update(cfg.clientSecret).digest('hex');
		const material = JSON.stringify({
			connectionId,
			tokenUrl: cfg.tokenUrl,
			clientId: cfg.clientId,
			scope: cfg.scope,
			audience: cfg.audience,
			authMethod: cfg.authMethod,
			params: cfg.params,
			secretHash,
		});
		// §5.B13: prefix with the connection id so all of a connection's cache/inflight entries can be
		// found and evicted by invalidate() (the hash alone is opaque).
		return `${connectionId}:${createHash('sha256').update(material).digest('hex')}`;
	}

	private errorToDiag(error: unknown): OAuthTokenDiagnosticsDto {
		if (error instanceof OAuthTokenError) {
			return {
				ok: false,
				reachable: error.options.reachable ?? true,
				statusCode: error.options.statusCode,
				tlsError: error.options.tlsError,
				error: redactSecrets(error.message),
			};
		}
		return {
			ok: false,
			reachable: false,
			error: redactSecrets(error instanceof Error ? error.message : 'OAuth token error'),
		};
	}

	private auditSuccess(connectionId: string, result: ExchangeResult): void {
		this.audit.recordSafe({
			category: 'sync',
			event: 'api_connection_oauth_token_obtained',
			actorType: 'system',
			subjectType: 'ApiConnection',
			subjectId: connectionId,
			metadata: {
				statusCode: result.statusCode,
				expiresIn: result.expiresIn,
				grantedScope: result.grantedScope ?? null,
			},
		});
	}

	private auditFailure(connectionId: string, error: unknown): void {
		const opts = error instanceof OAuthTokenError ? error.options : {};
		this.audit.recordSafe({
			category: 'sync',
			event: 'api_connection_oauth_token_failed',
			actorType: 'system',
			subjectType: 'ApiConnection',
			subjectId: connectionId,
			metadata: {
				statusCode: opts.statusCode ?? null,
				tlsError: opts.tlsError ?? false,
				error: redactSecrets(error instanceof Error ? error.message : String(error)),
			},
		});
	}

	private httpTimeoutMs(): number {
		return this.boundedInt(
			'OAUTH_TOKEN_HTTP_TIMEOUT_MS',
			DEFAULT_OAUTH_TOKEN_HTTP_TIMEOUT_MS,
			1000,
			120_000,
		);
	}
	private refreshSkewSeconds(): number {
		return this.boundedInt(
			'OAUTH_TOKEN_REFRESH_SKEW_SECONDS',
			DEFAULT_OAUTH_TOKEN_REFRESH_SKEW_SECONDS,
			0,
			3600,
		);
	}
	private minTtlSeconds(): number {
		return this.boundedInt(
			'OAUTH_TOKEN_MIN_TTL_SECONDS',
			DEFAULT_OAUTH_TOKEN_MIN_TTL_SECONDS,
			1,
			3600,
		);
	}
	private maxTtlSeconds(): number {
		return this.boundedInt(
			'OAUTH_TOKEN_MAX_TTL_SECONDS',
			DEFAULT_OAUTH_TOKEN_MAX_TTL_SECONDS,
			60,
			604_800,
		);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		// §6.1: delegate to the shared helper (adds correct empty-string handling).
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}
}
