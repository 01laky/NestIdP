import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getByPath, type ResolvedApiContract } from '@nestidp/shared';
import { boundedInt as boundedIntFromRaw } from '../../common/config/bounded-int.util';
import type { Dispatcher } from 'undici';
import { normalizeBaseUrl } from '../../api-connections/utils/base-url.util';
import { ExternalApiValidationError } from '../validators/external-api.validator';
import { IdentitySyncHttpError } from '../identity-sync.errors';

export const DEFAULT_SYNC_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_SYNC_STALE_RUN_MINUTES = 30;
export const DEFAULT_SYNC_MAX_USERS_PER_RUN = 10_000;
export const DEFAULT_SYNC_MAX_GROUPS_PER_USER = 1000;
export const DEFAULT_SYNC_MAX_ROLES_PER_USER = 1000;
export const DEFAULT_SYNC_MEMBERSHIP_FETCH_CONCURRENCY = 5;

@Injectable()
export class IdentitySyncClientService {
	constructor(private readonly configService: ConfigService) {}

	getHttpTimeoutMs(): number {
		return this.boundedInt('SYNC_HTTP_TIMEOUT_MS', DEFAULT_SYNC_HTTP_TIMEOUT_MS, 1000, 120_000);
	}

	getMaxUsersPerRun(): number {
		return this.boundedInt('SYNC_MAX_USERS_PER_RUN', DEFAULT_SYNC_MAX_USERS_PER_RUN, 1, 100_000);
	}

	getStaleRunMinutes(): number {
		return this.boundedInt('SYNC_STALE_RUN_MINUTES', DEFAULT_SYNC_STALE_RUN_MINUTES, 1, 1440);
	}

	getMaxGroupsPerUser(contract?: ResolvedApiContract): number {
		return (
			contract?.maxGroupsPerUser ??
			this.boundedInt('SYNC_MAX_GROUPS_PER_USER', DEFAULT_SYNC_MAX_GROUPS_PER_USER, 1, 100_000)
		);
	}

	getMaxRolesPerUser(contract?: ResolvedApiContract): number {
		return (
			contract?.maxRolesPerUser ??
			this.boundedInt('SYNC_MAX_ROLES_PER_USER', DEFAULT_SYNC_MAX_ROLES_PER_USER, 1, 100_000)
		);
	}

	getMembershipFetchConcurrency(): number {
		return this.boundedInt(
			'SYNC_MEMBERSHIP_FETCH_CONCURRENCY',
			DEFAULT_SYNC_MEMBERSHIP_FETCH_CONCURRENCY,
			1,
			50,
		);
	}

	/** Paginated + envelope-extracted raw users array. `dispatcher` routes through a proxy when set. */
	async fetchUsersRaw(
		baseUrl: string,
		bearerToken: string,
		contract: ResolvedApiContract,
		dispatcher?: Dispatcher,
	): Promise<unknown[]> {
		return this.fetchCollectionRaw(baseUrl, bearerToken, contract.endpoints.usersPath, contract, {
			responseRoot: contract.responseRoot.users,
			cap: this.getMaxUsersPerRun(),
			dispatcher,
		});
	}

	async fetchGroupsRawForUser(
		baseUrl: string,
		bearerToken: string,
		externalUserId: string,
		contract: ResolvedApiContract,
		dispatcher?: Dispatcher,
	): Promise<unknown[]> {
		const path = this.substituteId(contract.endpoints.userGroupsPath, externalUserId);
		return this.fetchCollectionRaw(baseUrl, bearerToken, path, contract, {
			responseRoot: contract.responseRoot.groups,
			cap: this.getMaxGroupsPerUser(contract),
			dispatcher,
		});
	}

	async fetchRolesRawForUser(
		baseUrl: string,
		bearerToken: string,
		externalUserId: string,
		contract: ResolvedApiContract,
		dispatcher?: Dispatcher,
	): Promise<unknown[]> {
		const path = this.substituteId(contract.endpoints.userRolesPath, externalUserId);
		return this.fetchCollectionRaw(baseUrl, bearerToken, path, contract, {
			responseRoot: contract.responseRoot.roles,
			cap: this.getMaxRolesPerUser(contract),
			dispatcher,
		});
	}

	private substituteId(template: string, externalUserId: string): string {
		return template.replace(':id', encodeURIComponent(externalUserId));
	}

	private buildUrl(
		baseUrl: string,
		path: string,
		queryParams: Record<string, string>,
		extra?: Record<string, string | number>,
	): string {
		const normalized = normalizeBaseUrl(baseUrl);
		const url = new URL(path, `${normalized}/`);
		for (const [k, v] of Object.entries(queryParams)) {
			url.searchParams.set(k, v);
		}
		if (extra) {
			for (const [k, v] of Object.entries(extra)) {
				url.searchParams.set(k, String(v));
			}
		}
		// Defense-in-depth: a stored path must not redirect off the base origin.
		if (url.origin !== new URL(normalized).origin) {
			throw new IdentitySyncHttpError('Resolved request URL left the base origin', {
				url: url.toString(),
				reachable: false,
			});
		}
		return url.toString();
	}

	private async fetchJson(
		url: string,
		bearerToken: string,
		headers: Record<string, string>,
		dispatcher?: Dispatcher,
	): Promise<unknown> {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					...headers,
					Authorization: `Bearer ${bearerToken}`,
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(this.getHttpTimeoutMs()),
				...(dispatcher ? { dispatcher } : {}),
			} as RequestInit & { dispatcher?: Dispatcher });
			if (response.status < 200 || response.status >= 300) {
				throw new IdentitySyncHttpError(`Identity API returned HTTP ${response.status}`, {
					statusCode: response.status,
					url,
					reachable: true,
				});
			}
			try {
				return await response.json();
			} catch {
				throw new IdentitySyncHttpError('Identity API returned invalid JSON', {
					url,
					reachable: true,
				});
			}
		} catch (error) {
			if (error instanceof IdentitySyncHttpError) {
				throw error;
			}
			if (error instanceof Error && error.name === 'TimeoutError') {
				throw new IdentitySyncHttpError('Identity API request timed out', { reachable: false });
			}
			throw new IdentitySyncHttpError('Could not reach identity API', { reachable: false });
		}
	}

	private extractArray(body: unknown, responseRoot: string, url: string): unknown[] {
		const value = responseRoot ? getByPath(body, responseRoot) : body;
		if (!Array.isArray(value)) {
			throw new ExternalApiValidationError(
				responseRoot
					? `Response did not contain an array at "${responseRoot}"`
					: 'Response must be a JSON array',
			);
		}
		void url;
		return value;
	}

	private async fetchCollectionRaw(
		baseUrl: string,
		bearerToken: string,
		path: string,
		contract: ResolvedApiContract,
		opts: { responseRoot: string; cap: number; dispatcher?: Dispatcher },
	): Promise<unknown[]> {
		const { pagination, queryParams, headers } = contract;

		if (pagination.mode === 'none') {
			const url = this.buildUrl(baseUrl, path, queryParams);
			return this.extractArray(
				await this.fetchJson(url, bearerToken, headers, opts.dispatcher),
				opts.responseRoot,
				url,
			);
		}

		const pageSize = pagination.pageSize ?? 100;
		const maxPages = pagination.maxPages ?? 50;
		const accumulated: unknown[] = [];
		let pageIndex = 0;
		let offset = 0;
		let page = pagination.startPage ?? 1;

		while (pageIndex < maxPages) {
			const extra: Record<string, string | number> = {};
			if (pagination.limitParam) {
				extra[pagination.limitParam] = pageSize;
			}
			if (pagination.mode === 'offset' && pagination.offsetParam) {
				extra[pagination.offsetParam] = offset;
			}
			if (pagination.mode === 'page' && pagination.pageParam) {
				extra[pagination.pageParam] = page;
			}
			const url = this.buildUrl(baseUrl, path, queryParams, extra);
			const pageRows = this.extractArray(
				await this.fetchJson(url, bearerToken, headers, opts.dispatcher),
				opts.responseRoot,
				url,
			);
			for (const row of pageRows) {
				accumulated.push(row);
				if (accumulated.length >= opts.cap) {
					return accumulated.slice(0, opts.cap);
				}
			}
			if (pageRows.length < pageSize) {
				break;
			}
			pageIndex += 1;
			offset += pageSize;
			page += 1;
		}
		return accumulated;
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		// §6.1: delegate to the shared helper (adds correct empty-string handling).
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}
}
