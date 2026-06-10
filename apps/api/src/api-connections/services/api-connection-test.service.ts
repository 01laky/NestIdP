import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
	ApiConnectionPreviewUserDto,
	ApiConnectionTestResponseDto,
	ApiConnectionTestTokenResponseDto,
	ApiContractConfig,
	OAuthTokenDiagnosticsDto,
	ProxyCheckResultDto,
	ResolvedApiContract,
} from '@nestidp/shared';
import { resolveApiContract } from '@nestidp/shared';
import type { Dispatcher } from 'undici';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { redactBearerToken, redactSecrets } from '../../encryption/utils/redact-secret.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { IdentitySyncClientService } from '../../sync/services/identity-sync-client.service';
import { OAuthTokenService } from '../../sync/services/oauth-token.service';
import { ProxyDispatcherService } from '../../sync/services/proxy-dispatcher.service';
import { buildOutboundUrl, extractArrayAt, outboundFetch } from '../../sync/utils/outbound-http.util';
import { annotateIfProxied, classifyProxyError } from '../../sync/utils/proxy-error.util';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { normalizeBaseUrl } from '../utils/base-url.util';
import {
	assertUsersArrayWithinLimit,
	ExternalApiValidationError,
	mapExternalUserRow,
} from '../../sync/validators/external-api.validator';

const TEST_TIMEOUT_MS = 10_000;
const PROXY_CHECK_TIMEOUT_MS = 8_000;
const PREVIEW_LIMIT = 5;

@Injectable()
export class ApiConnectionTestService {
	private readonly logger = new Logger(ApiConnectionTestService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: ApiConnectionsAuditService,
		private readonly oauthTokenService: OAuthTokenService,
		private readonly proxyDispatcher: ProxyDispatcherService,
		private readonly identitySyncClient: IdentitySyncClientService,
	) {}

	/** Token-exchange-only diagnostics (POST /:id/test-token). Never returns the token. */
	async testToken(id: string): Promise<ApiConnectionTestTokenResponseDto> {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}
		if (row.authType !== 'OAUTH2_CLIENT_CREDENTIALS') {
			return {
				ok: false,
				reachable: false,
				error: 'Connection is not configured for OAuth 2.0 Client Credentials',
			};
		}
		const { diag } = await this.oauthTokenService.fetchDiagnostics(row);
		return diag;
	}

	/** Proxy-hop-only diagnostic (POST /:id/test-proxy). Isolates "proxy is dead/rejects auth" from
	 * "target is down" without running the full contract fetch. Never returns/logs the proxy password. */
	async testProxy(id: string): Promise<ProxyCheckResultDto> {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}
		const target = normalizeBaseUrl(row.baseUrl);
		const proxyHost = this.proxyDispatcher.proxyHostLabel(row);

		// Off or bypassed → a no-op, not a failure.
		if (!this.proxyDispatcher.isProxied(row, target)) {
			const result: ProxyCheckResultDto = {
				ok: true,
				status: 'bypassed',
				message: row.proxyEnabled
					? 'Target bypasses the proxy (no-proxy match) — would connect directly'
					: 'Proxy is disabled for this connection — connects directly',
				viaProxy: false,
				bypassed: true,
				proxyHost,
			};
			await this.persistProxyCheck(id, result.status);
			this.audit.logProxyChecked(id, row.name, result.status, result.viaProxy, proxyHost);
			return result;
		}

		const dispatcher = this.proxyDispatcher.resolve(row, target);
		let result: ProxyCheckResultDto;
		try {
			// Any HTTP response (even 4xx/5xx from the target) means the proxy hop + tunnel succeeded.
			const res = await fetch(target, {
				method: 'HEAD',
				signal: AbortSignal.timeout(PROXY_CHECK_TIMEOUT_MS),
				...(dispatcher ? { dispatcher } : {}),
			} as RequestInit & { dispatcher?: Dispatcher });
			result = {
				ok: true,
				status: 'ok',
				message: `Reached the target through the proxy (HTTP ${res.status})`,
				viaProxy: true,
				bypassed: false,
				proxyHost,
			};
		} catch (error) {
			const { status, message } = classifyProxyError(error, { proxied: true });
			this.logger.warn(
				`Proxy check failed for connection ${id}: ${redactSecrets(error instanceof Error ? error.message : 'unknown')}`,
			);
			result = {
				ok: false,
				status,
				message: redactSecrets(message),
				viaProxy: status !== 'auth_failed' && status !== 'unreachable' ? true : false,
				bypassed: false,
				proxyHost,
			};
		}
		await this.persistProxyCheck(id, result.status);
		this.audit.logProxyChecked(id, row.name, result.status, result.viaProxy, proxyHost);
		return result;
	}

	private async persistProxyCheck(id: string, status: string): Promise<void> {
		await this.prisma.apiConnection.update({
			where: { id },
			data: { lastProxyCheckStatus: status, lastProxyCheckAt: new Date() },
		});
	}

	async testConnection(id: string): Promise<ApiConnectionTestResponseDto> {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}

		let token: string;
		let tokenEndpoint: OAuthTokenDiagnosticsDto | undefined;
		if (row.authType === 'OAUTH2_CLIENT_CREDENTIALS') {
			const result = await this.oauthTokenService.fetchDiagnostics(row);
			tokenEndpoint = result.diag;
			if (!result.diag.ok || !result.token) {
				return {
					ok: false,
					reachable: result.diag.reachable,
					statusCode: result.diag.statusCode,
					message: result.diag.error ?? 'OAuth token endpoint failed',
					tokenEndpoint: result.diag,
				};
			}
			token = result.token;
		} else {
			try {
				token = this.encryption.decrypt(row.authCredentialsEncrypted);
			} catch (error) {
				this.logger.warn(
					`Failed to decrypt credentials for connection ${id}: ${redactBearerToken(String(error))}`,
				);
				return {
					ok: false,
					reachable: false,
					message: 'Stored credentials could not be decrypted',
				};
			}
		}

		const contract = resolveApiContract(
			(row.apiContractConfig as ApiContractConfig | null) ?? null,
		);
		const usersUrl = this.buildUrl(row.baseUrl, contract.endpoints.usersPath, contract, true);
		const proxied = this.proxyDispatcher.isProxied(row, usersUrl);
		const dispatcher = this.proxyDispatcher.resolve(row, usersUrl);

		let response: Response;
		try {
			response = await this.fetch(usersUrl, token, contract, dispatcher);
		} catch (error) {
			return this.unreachable(id, error, proxied);
		}

		const ok = response.status >= 200 && response.status < 300;
		const result: ApiConnectionTestResponseDto = {
			ok,
			reachable: true,
			statusCode: response.status,
			message: ok
				? proxied
					? 'Identity API responded successfully (through the proxy)'
					: 'Identity API responded successfully'
				: `Identity API returned HTTP ${response.status}`,
			...(proxied ? { viaProxy: true } : {}),
			...(tokenEndpoint ? { tokenEndpoint } : {}),
		};
		this.audit.logTested(id, true, response.status);

		if (!ok) {
			return result;
		}

		// Contract diagnostics: parse + map under the resolved contract.
		try {
			const body = await response.json();
			// §5.C: the preview obeys the same users-per-run cap as a real sync — a huge target yields a
			// clear validation error instead of an unbounded parse/map loop.
			const array = assertUsersArrayWithinLimit(
				this.extractArray(body, contract.responseRoot.users),
				this.identitySyncClient.getMaxUsersPerRun(),
			);
			const sample: ApiConnectionPreviewUserDto[] = [];
			let firstUserId: string | undefined;
			for (const raw of array) {
				const user = mapExternalUserRow(raw, {
					fieldMap: contract.userFieldMap,
					passwordHashAlgorithmConstant: contract.passwordHashAlgorithmConstant,
					activeMapping: contract.activeMapping,
					defaults: contract.defaults,
				});
				if (firstUserId === undefined) {
					firstUserId = user.id;
				}
				if (sample.length < PREVIEW_LIMIT) {
					sample.push({
						id: user.id,
						username: user.username,
						email: user.email ?? null,
						displayName: user.displayName ?? null,
						active: user.active,
						passwordHashAlgorithm: user.passwordHashAlgorithm,
					});
				}
			}
			result.previewUsersCount = array.length;
			result.previewSample = sample;

			const membershipError = await this.probeMemberships(
				row.baseUrl,
				token,
				contract,
				firstUserId,
				dispatcher,
			);
			if (membershipError) {
				result.contractError = membershipError;
			}
		} catch (error) {
			result.contractError =
				error instanceof ExternalApiValidationError || error instanceof Error
					? error.message
					: 'Contract mapping failed';
		}

		return result;
	}

	/** E8: probe the groups/roles endpoints for the first user (endpoint mode only). */
	private async probeMemberships(
		baseUrl: string,
		token: string,
		contract: ResolvedApiContract,
		firstUserId: string | undefined,
		dispatcher?: Dispatcher,
	): Promise<string | undefined> {
		if (firstUserId === undefined) {
			return undefined;
		}
		const probes: Array<{ label: string; path: string }> = [];
		if (contract.membershipSource.groups.mode === 'endpoint') {
			probes.push({
				label: 'groups',
				path: contract.endpoints.userGroupsPath.replace(':id', encodeURIComponent(firstUserId)),
			});
		}
		if (contract.membershipSource.roles.mode === 'endpoint') {
			probes.push({
				label: 'roles',
				path: contract.endpoints.userRolesPath.replace(':id', encodeURIComponent(firstUserId)),
			});
		}
		for (const probe of probes) {
			try {
				const url = this.buildUrl(baseUrl, probe.path, contract, false);
				const res = await this.fetch(url, token, contract, dispatcher);
				if (res.status < 200 || res.status >= 300) {
					return `${probe.label} endpoint: HTTP ${res.status}`;
				}
			} catch {
				return `${probe.label} endpoint: unreachable`;
			}
		}
		return undefined;
	}

	private buildUrl(
		baseUrl: string,
		path: string,
		contract: ResolvedApiContract,
		applyLimit: boolean,
	): string {
		return buildOutboundUrl({
			baseUrl,
			path,
			queryParams: contract.queryParams,
			extraParams:
				applyLimit && contract.pagination.limitParam
					? { [contract.pagination.limitParam]: contract.pagination.pageSize ?? 50 }
					: undefined,
			onOriginViolation: () =>
				new ExternalApiValidationError('Resolved request URL left the base origin'),
		});
	}

	private async fetch(
		url: string,
		token: string,
		contract: ResolvedApiContract,
		dispatcher?: Dispatcher,
	): Promise<Response> {
		return outboundFetch({
			url,
			bearerToken: token,
			headers: contract.headers,
			timeoutMs: TEST_TIMEOUT_MS,
			dispatcher,
		});
	}

	private extractArray(body: unknown, responseRoot: string): unknown[] {
		return extractArrayAt(body, responseRoot, 'Users response must be a JSON array');
	}

	private unreachable(id: string, error: unknown, proxied = false): ApiConnectionTestResponseDto {
		this.logger.warn(
			`Connectivity test failed for connection ${id}: ${redactSecrets(error instanceof Error ? error.message : 'unknown error')}`,
		);
		this.audit.logTested(id, false);
		const viaProxy = proxied ? { viaProxy: true } : {};
		if (error instanceof Error && error.name === 'TimeoutError') {
			return {
				ok: false,
				reachable: false,
				message: annotateIfProxied('Identity API request timed out', error, proxied),
				...viaProxy,
			};
		}
		return {
			ok: false,
			reachable: false,
			message: annotateIfProxied('Could not reach identity API', error, proxied),
			...viaProxy,
		};
	}
}
