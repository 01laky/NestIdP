import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeBaseUrl } from '../api-connections/base-url.util';
import {
	ExternalApiValidationError,
	parseExternalGroupsJson,
	parseExternalRolesJson,
	parseExternalUsersJson,
} from './external-api.validator';
import type { ExternalGroupDto, ExternalRoleDto, ExternalUserDto } from './external-api.types';
import { IdentitySyncHttpError } from './identity-sync.errors';

export const DEFAULT_SYNC_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_SYNC_STALE_RUN_MINUTES = 30;
export const DEFAULT_SYNC_MAX_USERS_PER_RUN = 10_000;

@Injectable()
export class IdentitySyncClientService {
	constructor(private readonly configService: ConfigService) {}

	getHttpTimeoutMs(): number {
		const raw = this.configService.get<number | string>('SYNC_HTTP_TIMEOUT_MS');
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
			return parsed;
		}
		return DEFAULT_SYNC_HTTP_TIMEOUT_MS;
	}

	getMaxUsersPerRun(): number {
		const raw = this.configService.get<number | string>('SYNC_MAX_USERS_PER_RUN');
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100_000) {
			return parsed;
		}
		return DEFAULT_SYNC_MAX_USERS_PER_RUN;
	}

	getStaleRunMinutes(): number {
		const raw = this.configService.get<number | string>('SYNC_STALE_RUN_MINUTES');
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1440) {
			return parsed;
		}
		return DEFAULT_SYNC_STALE_RUN_MINUTES;
	}

	private buildUrl(baseUrl: string, path: string): string {
		const normalized = normalizeBaseUrl(baseUrl);
		return new URL(path, `${normalized}/`).toString();
	}

	private async fetchJson(url: string, bearerToken: string): Promise<unknown> {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${bearerToken}`,
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(this.getHttpTimeoutMs()),
			});
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

	async fetchUsersRaw(baseUrl: string, bearerToken: string): Promise<unknown> {
		const url = this.buildUrl(baseUrl, '/users');
		return this.fetchJson(url, bearerToken);
	}

	async fetchUsers(baseUrl: string, bearerToken: string): Promise<ExternalUserDto[]> {
		const body = await this.fetchUsersRaw(baseUrl, bearerToken);
		try {
			return parseExternalUsersJson(body, { maxUsers: this.getMaxUsersPerRun() });
		} catch (error) {
			if (error instanceof ExternalApiValidationError) {
				throw new IdentitySyncHttpError(error.message, {
					url: this.buildUrl(baseUrl, '/users'),
					reachable: true,
				});
			}
			throw error;
		}
	}

	async fetchGroupsForUser(
		baseUrl: string,
		bearerToken: string,
		externalUserId: string,
	): Promise<ExternalGroupDto[]> {
		const encoded = encodeURIComponent(externalUserId);
		const url = this.buildUrl(baseUrl, `/users/${encoded}/groups`);
		const body = await this.fetchJson(url, bearerToken);
		try {
			return parseExternalGroupsJson(body);
		} catch (error) {
			if (error instanceof ExternalApiValidationError) {
				throw new IdentitySyncHttpError(error.message, { url, reachable: true });
			}
			throw error;
		}
	}

	async fetchRolesForUser(
		baseUrl: string,
		bearerToken: string,
		externalUserId: string,
	): Promise<ExternalRoleDto[]> {
		const encoded = encodeURIComponent(externalUserId);
		const url = this.buildUrl(baseUrl, `/users/${encoded}/roles`);
		const body = await this.fetchJson(url, bearerToken);
		try {
			return parseExternalRolesJson(body);
		} catch (error) {
			if (error instanceof ExternalApiValidationError) {
				throw new IdentitySyncHttpError(error.message, { url, reachable: true });
			}
			throw error;
		}
	}
}
