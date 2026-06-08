import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiConnection, Prisma } from '@prisma/client';
import type {
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	AuthType,
	CreateApiConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	UpdateApiConnectionRequestDto,
} from '@nestidp/shared';
import {
	ApiContractValidationError,
	assertValidApiContractConfig,
	assertValidOAuthConfig,
	OAuthConfigValidationError,
	ProxyConfigError,
	validateProxyUrl,
} from '@nestidp/shared';
import { NodeEnv } from '../../config/env.validation';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { PrismaService } from '../../prisma/services/prisma.service';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import { OAuthTokenService } from '../../sync/services/oauth-token.service';
import { ProxyDispatcherService } from '../../sync/services/proxy-dispatcher.service';
import { assertValidBaseUrl, BaseUrlValidationError } from '../utils/base-url.util';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { toApiConnectionDto } from '../mappers/api-connections.mapper';

@Injectable()
export class ApiConnectionsService {
	private readonly logger = new Logger(ApiConnectionsService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly configService: ConfigService,
		private readonly audit: ApiConnectionsAuditService,
		private readonly oauthTokenService: OAuthTokenService,
		private readonly identityStore: ActiveIdentityStore,
		private readonly proxyDispatcher: ProxyDispatcherService,
	) {}

	async list(): Promise<ApiConnectionListResponseDto> {
		const rows = await this.prisma.apiConnection.findMany({
			where: { isLocalDirectory: false },
			orderBy: { createdAt: 'asc' },
		});
		return { connections: rows.map((row) => this.toDto(row)) };
	}

	async getById(id: string): Promise<ApiConnectionResponseDto> {
		const row = await this.findOrThrow(id);
		return { connection: this.toDto(row) };
	}

	async create(body: CreateApiConnectionRequestDto): Promise<ApiConnectionResponseDto> {
		const count = await this.prisma.apiConnection.count({
			where: { isLocalDirectory: false },
		});
		if (count >= 1) {
			throw new ConflictException('Only one API connection is supported in v1');
		}

		await this.assertNameAvailable(body.name);

		const baseUrl = this.validateBaseUrl(body.baseUrl);
		const apiContractConfig = this.validateContract(body.apiContractConfig);
		const authType: AuthType = body.authType ?? 'BEARER';

		const data: Prisma.ApiConnectionCreateInput = {
			name: body.name.trim(),
			baseUrl,
			authType,
			authCredentialsEncrypted: '',
			apiContractConfig: apiContractConfig
				? (apiContractConfig as unknown as Prisma.InputJsonValue)
				: Prisma.JsonNull,
		};

		if (authType === 'OAUTH2_CLIENT_CREDENTIALS') {
			this.applyOAuthData(data, body, { secretRequired: true });
		} else {
			if (!body.bearerToken || body.bearerToken.length === 0) {
				throw new BadRequestException('bearerToken is required for BEARER auth');
			}
			data.authCredentialsEncrypted = this.encryption.encrypt(body.bearerToken);
		}

		this.applyProxyData(data, body, null);

		const row = await this.prisma.apiConnection.create({ data });
		if (this.proxyTouched(body)) {
			this.audit.logProxyUpdated(row.id, row.name, this.proxyAuditDetail(row));
		}
		return { connection: this.toDto(row) };
	}

	async update(id: string, body: UpdateApiConnectionRequestDto): Promise<ApiConnectionResponseDto> {
		if (
			!body.name &&
			!body.baseUrl &&
			body.bearerToken === undefined &&
			body.apiContractConfig === undefined &&
			body.authType === undefined &&
			body.oauthTokenUrl === undefined &&
			body.oauthClientId === undefined &&
			body.oauthClientSecret === undefined &&
			body.oauthScope === undefined &&
			body.oauthAudience === undefined &&
			body.oauthClientAuthMethod === undefined &&
			body.oauthTokenRequestParams === undefined &&
			!this.proxyTouched(body)
		) {
			throw new BadRequestException('At least one field must be provided');
		}

		const existing = await this.findOrThrow(id);

		if (body.name !== undefined) {
			if (body.name.trim().length === 0) {
				throw new BadRequestException('name must not be empty');
			}
			await this.assertNameAvailable(body.name, id);
		}

		const data: Prisma.ApiConnectionUpdateInput = {};

		if (body.name !== undefined) {
			data.name = body.name.trim();
		}
		if (body.baseUrl !== undefined) {
			data.baseUrl = this.validateBaseUrl(body.baseUrl);
		}
		if (body.apiContractConfig !== undefined) {
			const validated = this.validateContract(body.apiContractConfig);
			data.apiContractConfig = validated
				? (validated as unknown as Prisma.InputJsonValue)
				: Prisma.JsonNull;
		}

		const targetAuthType: AuthType = body.authType ?? existing.authType;
		const authTypeChanged = targetAuthType !== existing.authType;

		if (targetAuthType === 'OAUTH2_CLIENT_CREDENTIALS') {
			data.authType = 'OAUTH2_CLIENT_CREDENTIALS';
			if (body.bearerToken !== undefined) {
				throw new BadRequestException('bearerToken is not used with OAuth 2.0 Client Credentials');
			}
			const hasStoredSecret = (existing.oauthClientSecretEncrypted ?? '').length > 0;
			this.applyOAuthData(data, body, { secretRequired: authTypeChanged || !hasStoredSecret });
			if (authTypeChanged) {
				data.authCredentialsEncrypted = '';
			}
		} else {
			data.authType = 'BEARER';
			if (body.bearerToken !== undefined) {
				if (body.bearerToken.length === 0) {
					throw new BadRequestException('bearerToken must not be empty');
				}
				data.authCredentialsEncrypted = this.encryption.encrypt(body.bearerToken);
			} else if (authTypeChanged) {
				throw new BadRequestException('bearerToken is required when switching to BEARER auth');
			}
			if (authTypeChanged) {
				data.oauthTokenUrl = null;
				data.oauthClientId = null;
				data.oauthClientSecretEncrypted = null;
				data.oauthScope = null;
				data.oauthAudience = null;
				data.oauthClientAuthMethod = null;
				data.oauthTokenRequestParams = Prisma.JsonNull;
			}
		}

		this.applyProxyData(data, body, existing);

		const row = await this.prisma.apiConnection.update({
			where: { id: existing.id },
			data,
		});

		if (this.proxyTouched(body)) {
			// A proxy-config change supersedes any cached ProxyAgent — close it so the next call rebuilds.
			this.proxyDispatcher.invalidate(row.id);
			this.audit.logProxyUpdated(row.id, row.name, this.proxyAuditDetail(row));
		}

		this.audit.logUpdated(row.id, row.name);
		if (authTypeChanged) {
			this.audit.logAuthTypeChanged(row.id, row.name, row.authType);
		}
		if (body.apiContractConfig !== undefined) {
			const sections =
				body.apiContractConfig === null
					? ['reset']
					: Object.keys(body.apiContractConfig as Record<string, unknown>);
			this.audit.logContractUpdated(row.id, row.name, sections);
		}
		return { connection: this.toDto(row) };
	}

	async delete(id: string): Promise<DeleteApiConnectionResponseDto> {
		const existing = await this.findOrThrow(id);
		// Cross-store guard (Prompt 31): the local FK Restrict cannot see identity rows that live in an
		// external database (relocate mode), so check the active identity store explicitly.
		if (await this.identityStore.connectionHasIdentityRows(id)) {
			throw new ConflictException('Cannot delete API connection with synced identity data');
		}
		try {
			await this.prisma.apiConnection.delete({ where: { id } });
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
				throw new ConflictException('Cannot delete API connection with synced identity data');
			}
			throw error;
		}
		this.proxyDispatcher.invalidate(id);
		this.audit.logDeleted(existing.id, existing.name);
		return { ok: true, id };
	}

	private toDto(row: ApiConnection) {
		const oauthLastTokenAt =
			row.authType === 'OAUTH2_CLIENT_CREDENTIALS'
				? this.oauthTokenService.getLastTokenAt(row.id)
				: null;
		return toApiConnectionDto(row, { oauthLastTokenAt });
	}

	private applyOAuthData(
		data: Prisma.ApiConnectionCreateInput | Prisma.ApiConnectionUpdateInput,
		body: CreateApiConnectionRequestDto | UpdateApiConnectionRequestDto,
		opts: { secretRequired: boolean },
	): void {
		let validated;
		try {
			validated = assertValidOAuthConfig({
				oauthTokenUrl: body.oauthTokenUrl,
				oauthClientId: body.oauthClientId,
				oauthScope: body.oauthScope,
				oauthAudience: body.oauthAudience,
				oauthClientAuthMethod: body.oauthClientAuthMethod ?? undefined,
				oauthTokenRequestParams: body.oauthTokenRequestParams,
			});
		} catch (error) {
			if (error instanceof OAuthConfigValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}

		data.oauthTokenUrl = validated.oauthTokenUrl;
		data.oauthClientId = validated.oauthClientId;
		data.oauthScope = validated.oauthScope;
		data.oauthAudience = validated.oauthAudience;
		data.oauthClientAuthMethod = validated.oauthClientAuthMethod;
		data.oauthTokenRequestParams = validated.oauthTokenRequestParams
			? (validated.oauthTokenRequestParams as unknown as Prisma.InputJsonValue)
			: Prisma.JsonNull;

		if (body.oauthClientSecret !== undefined && body.oauthClientSecret !== null) {
			if (body.oauthClientSecret.length === 0) {
				throw new BadRequestException('oauthClientSecret must not be empty');
			}
			data.oauthClientSecretEncrypted = this.encryption.encrypt(body.oauthClientSecret);
		} else if (opts.secretRequired) {
			throw new BadRequestException('oauthClientSecret is required');
		}
	}

	/** True when the request touches any proxy field (drives the update guard, audit, and invalidate). */
	private proxyTouched(
		body: CreateApiConnectionRequestDto | UpdateApiConnectionRequestDto,
	): boolean {
		return (
			body.proxyEnabled !== undefined ||
			body.proxyUrl !== undefined ||
			body.proxyUsername !== undefined ||
			body.proxyPassword !== undefined ||
			body.noProxyHosts !== undefined
		);
	}

	private proxyAuditDetail(row: ApiConnection) {
		return {
			enabled: row.proxyEnabled,
			proxyHost: this.proxyDispatcher.proxyHostLabel(row),
			hasAuth: !!row.proxyUsername,
			hasNoProxy: !!row.noProxyHosts,
		};
	}

	/**
	 * Validate + apply proxy fields. `existing` is null on create. When proxy is enabled a proxy URL is
	 * required (provided now or already stored). The password is write-only: omit keeps it, `null`
	 * clears it, empty string is rejected; it is encrypted at rest via CREDENTIALS_ENCRYPTION.
	 */
	private applyProxyData(
		data: Prisma.ApiConnectionCreateInput | Prisma.ApiConnectionUpdateInput,
		body: CreateApiConnectionRequestDto | UpdateApiConnectionRequestDto,
		existing: ApiConnection | null,
	): void {
		if (!this.proxyTouched(body)) {
			return;
		}

		// Resolve the effective proxy URL (after this request) for the "enabled requires URL" check.
		let effectiveUrl: string | null = existing?.proxyUrl ?? null;
		if (body.proxyUrl !== undefined) {
			if (body.proxyUrl === null || body.proxyUrl.trim() === '') {
				data.proxyUrl = null;
				effectiveUrl = null;
			} else {
				let normalized: string;
				try {
					normalized = validateProxyUrl(body.proxyUrl);
				} catch (error) {
					if (error instanceof ProxyConfigError) {
						throw new BadRequestException(error.message);
					}
					throw error;
				}
				data.proxyUrl = normalized;
				effectiveUrl = normalized;
			}
		}

		const effectiveEnabled =
			body.proxyEnabled !== undefined ? body.proxyEnabled : (existing?.proxyEnabled ?? false);
		if (body.proxyEnabled !== undefined) {
			data.proxyEnabled = body.proxyEnabled;
		}
		if (effectiveEnabled && !effectiveUrl) {
			throw new BadRequestException('proxyUrl is required when the proxy is enabled');
		}

		if (body.proxyUsername !== undefined) {
			const trimmed = body.proxyUsername === null ? null : body.proxyUsername.trim();
			data.proxyUsername = trimmed && trimmed.length > 0 ? trimmed : null;
		}

		if (body.proxyPassword !== undefined) {
			if (body.proxyPassword === null) {
				data.proxyPasswordEncrypted = null;
			} else if (body.proxyPassword.length === 0) {
				throw new BadRequestException('proxyPassword must not be empty');
			} else {
				data.proxyPasswordEncrypted = this.encryption.encrypt(body.proxyPassword);
			}
		}

		if (body.noProxyHosts !== undefined) {
			const trimmed = body.noProxyHosts === null ? null : body.noProxyHosts.trim();
			data.noProxyHosts = trimmed && trimmed.length > 0 ? trimmed : null;
		}
	}

	private async findOrThrow(id: string) {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}
		if (row.isLocalDirectory) {
			throw new ForbiddenException('Local directory connection cannot be modified');
		}
		return row;
	}

	private validateContract(
		value: import('@nestidp/shared').ApiContractConfig | null | undefined,
	): import('@nestidp/shared').ApiContractConfig | null {
		if (value == null) {
			return null;
		}
		try {
			return assertValidApiContractConfig(value);
		} catch (error) {
			if (error instanceof ApiContractValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private validateBaseUrl(raw: string): string {
		try {
			return assertValidBaseUrl(raw, {
				requireHttps: this.configService.get<string>('NODE_ENV') === NodeEnv.Production,
			});
		} catch (error) {
			if (error instanceof BaseUrlValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
		const normalized = name.trim().toLowerCase();
		const existing = await this.prisma.apiConnection.findMany({
			where: excludeId ? { id: { not: excludeId } } : undefined,
			select: { id: true, name: true },
		});
		if (existing.some((row) => row.name.trim().toLowerCase() === normalized)) {
			throw new ConflictException('An API connection with this name already exists');
		}
	}
}
