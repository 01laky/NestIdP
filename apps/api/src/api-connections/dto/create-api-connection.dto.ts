import { Transform } from 'class-transformer';
import {
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

export class CreateApiConnectionBodyDto {
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	name!: string;

	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	baseUrl!: string;

	@IsOptional()
	@IsIn([...AUTH_TYPES])
	authType?: AuthType;

	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(4096)
	bearerToken?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsObject()
	apiContractConfig?: ApiContractConfig | null;

	// --- OAuth 2.0 Client Credentials (validated per authType in the service) ---
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
}
