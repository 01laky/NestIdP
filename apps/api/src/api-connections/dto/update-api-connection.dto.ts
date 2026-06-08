import { Transform } from 'class-transformer';
import {
	IsBoolean,
	IsIn,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	ValidateIf,
} from 'class-validator';
import type { ApiContractConfig, AuthType, OAuthClientAuthMethod } from '@nestidp/shared';
import { AUTH_TYPES, OAUTH_CLIENT_AUTH_METHODS } from '@nestidp/shared';

export class UpdateApiConnectionBodyDto {
	@IsOptional()
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	name?: string;

	@IsOptional()
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	baseUrl?: string;

	@IsOptional()
	@IsIn([...AUTH_TYPES])
	authType?: AuthType;

	@IsOptional()
	@ValidateIf((_o, value) => value !== undefined)
	@IsString()
	@IsNotEmpty()
	@MaxLength(4096)
	bearerToken?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsObject()
	apiContractConfig?: ApiContractConfig | null;

	// --- OAuth 2.0 Client Credentials ---
	@IsOptional()
	@IsString()
	@MaxLength(1024)
	oauthTokenUrl?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1024)
	oauthClientId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(4096)
	oauthClientSecret?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1024)
	oauthScope?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1024)
	oauthAudience?: string;

	@IsOptional()
	@IsIn(OAUTH_CLIENT_AUTH_METHODS.map((m) => m.id))
	oauthClientAuthMethod?: OAuthClientAuthMethod;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsObject()
	oauthTokenRequestParams?: Record<string, string> | null;

	// --- Outbound HTTP proxy (Prompt 33) ---
	@IsOptional()
	@IsBoolean()
	proxyEnabled?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(2048)
	proxyUrl?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(256)
	proxyUsername?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(1024)
	proxyPassword?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(4096)
	noProxyHosts?: string | null;
}
