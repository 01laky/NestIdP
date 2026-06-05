import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	GenerateIdpSigningCertRequestDto,
	IdpSigningEcCurve,
	IdpSigningKeyFamily,
	IdpSigningRsaModulusBits,
} from '@nestidp/shared';

export class GenerateIdpSigningCertBodyDto implements GenerateIdpSigningCertRequestDto {
	@IsOptional()
	@IsIn(['rsa', 'ec'])
	keyFamily?: IdpSigningKeyFamily;

	@ValidateIf((body: GenerateIdpSigningCertBodyDto) => (body.keyFamily ?? 'rsa') === 'rsa')
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn([2048, 3072, 4096])
	rsaModulusBits?: IdpSigningRsaModulusBits;

	@ValidateIf((body: GenerateIdpSigningCertBodyDto) => body.keyFamily === 'ec')
	@IsOptional()
	@IsIn(['P-256', 'P-384', 'P-521'])
	ecCurve?: IdpSigningEcCurve;

	@IsOptional()
	@IsString()
	signatureAlgorithmId?: string;

	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}
