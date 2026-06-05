import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type { IdpCertRsaModulusBits } from '@nestidp/shared';

export class StartIdpEncryptionCertRotationBodyDto {
	@IsIn(['generate', 'upload'])
	mode!: 'generate' | 'upload';

	@ValidateIf((body: StartIdpEncryptionCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	encryptionCertPem?: string;

	@ValidateIf((body: StartIdpEncryptionCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	encryptionPrivateKeyPem?: string;

	@ValidateIf((body: StartIdpEncryptionCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn([2048, 3072, 4096])
	rsaModulusBits?: IdpCertRsaModulusBits;

	@ValidateIf((body: StartIdpEncryptionCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}
