import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateIdpSettingsBodyDto {
	@IsOptional()
	@IsString()
	entityId?: string;

	@IsOptional()
	@IsString()
	nameIdFormat?: string;

	@IsOptional()
	@IsBoolean()
	wantAuthnRequestsSigned?: boolean;

	@IsOptional()
	@IsBoolean()
	autoRotateSigningEnabled?: boolean;

	@IsOptional()
	@IsBoolean()
	autoRotateEncryptionEnabled?: boolean;
}
