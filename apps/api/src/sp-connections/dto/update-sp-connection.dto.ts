import {
	IsBoolean,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	ValidateIf,
} from 'class-validator';
import type { SpAttributeMappingConfig } from '@nestidp/shared';

export class UpdateSpConnectionBodyDto {
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	name?: string;

	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(512)
	spEntityId?: string;

	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	acsUrl?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(2048)
	sloUrl?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(2048)
	sloSoapUrl?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(512)
	nameIdFormat?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsObject()
	attributeMapping?: SpAttributeMappingConfig | null;

	@IsOptional()
	@IsBoolean()
	active?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(16384)
	spCertificate?: string | null;

	@IsOptional()
	@IsBoolean()
	wantAssertionsEncrypted?: boolean;

	@IsOptional()
	@IsBoolean()
	wantAuthnRequestsSigned?: boolean;

	@IsOptional()
	@IsBoolean()
	wantLogoutRequestsSigned?: boolean;
}
