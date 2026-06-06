import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { ApiContractConfig } from '@nestidp/shared';

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
	@ValidateIf((_o, value) => value !== undefined)
	@IsString()
	@IsNotEmpty()
	@MaxLength(4096)
	bearerToken?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsObject()
	apiContractConfig?: ApiContractConfig | null;
}
