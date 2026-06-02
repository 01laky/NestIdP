import { IsOptional, IsString } from 'class-validator';

export class UpdateIdpSettingsBodyDto {
	@IsOptional()
	@IsString()
	entityId?: string;

	@IsOptional()
	@IsString()
	nameIdFormat?: string;
}
