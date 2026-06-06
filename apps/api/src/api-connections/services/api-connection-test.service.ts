import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
	ApiConnectionPreviewUserDto,
	ApiConnectionTestResponseDto,
	ApiContractConfig,
	ResolvedApiContract,
} from '@nestidp/shared';
import { getByPath, resolveApiContract } from '@nestidp/shared';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { redactBearerToken } from '../../encryption/utils/redact-secret.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { normalizeBaseUrl } from '../utils/base-url.util';
import {
	ExternalApiValidationError,
	mapExternalUserRow,
} from '../../sync/validators/external-api.validator';

const TEST_TIMEOUT_MS = 10_000;
const PREVIEW_LIMIT = 5;

@Injectable()
export class ApiConnectionTestService {
	private readonly logger = new Logger(ApiConnectionTestService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: ApiConnectionsAuditService,
	) {}

	async testConnection(id: string): Promise<ApiConnectionTestResponseDto> {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}

		let token: string;
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

		const contract = resolveApiContract(
			(row.apiContractConfig as ApiContractConfig | null) ?? null,
		);
		const usersUrl = this.buildUrl(row.baseUrl, contract.endpoints.usersPath, contract, true);

		let response: Response;
		try {
			response = await this.fetch(usersUrl, token, contract);
		} catch (error) {
			return this.unreachable(id, error);
		}

		const ok = response.status >= 200 && response.status < 300;
		const result: ApiConnectionTestResponseDto = {
			ok,
			reachable: true,
			statusCode: response.status,
			message: ok
				? 'Identity API responded successfully'
				: `Identity API returned HTTP ${response.status}`,
		};
		this.audit.logTested(id, true, response.status);

		if (!ok) {
			return result;
		}

		// Contract diagnostics: parse + map under the resolved contract.
		try {
			const body = await response.json();
			const array = this.extractArray(body, contract.responseRoot.users);
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
				const res = await this.fetch(url, token, contract);
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
		const normalized = normalizeBaseUrl(baseUrl);
		const url = new URL(path, `${normalized}/`);
		for (const [k, v] of Object.entries(contract.queryParams)) {
			url.searchParams.set(k, v);
		}
		if (applyLimit && contract.pagination.limitParam) {
			url.searchParams.set(
				contract.pagination.limitParam,
				String(contract.pagination.pageSize ?? 50),
			);
		}
		if (url.origin !== new URL(normalized).origin) {
			throw new ExternalApiValidationError('Resolved request URL left the base origin');
		}
		return url.toString();
	}

	private async fetch(
		url: string,
		token: string,
		contract: ResolvedApiContract,
	): Promise<Response> {
		return fetch(url, {
			method: 'GET',
			headers: {
				...contract.headers,
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
		});
	}

	private extractArray(body: unknown, responseRoot: string): unknown[] {
		const value = responseRoot ? getByPath(body, responseRoot) : body;
		if (!Array.isArray(value)) {
			throw new ExternalApiValidationError(
				responseRoot
					? `Response did not contain an array at "${responseRoot}"`
					: 'Users response must be a JSON array',
			);
		}
		return value;
	}

	private unreachable(id: string, error: unknown): ApiConnectionTestResponseDto {
		this.logger.warn(
			`Connectivity test failed for connection ${id}: ${error instanceof Error ? error.message : 'unknown error'}`,
		);
		this.audit.logTested(id, false);
		if (error instanceof Error && error.name === 'TimeoutError') {
			return { ok: false, reachable: false, message: 'Identity API request timed out' };
		}
		return { ok: false, reachable: false, message: 'Could not reach identity API' };
	}
}
