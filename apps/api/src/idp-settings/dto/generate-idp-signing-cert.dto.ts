import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	GenerateIdpSigningCertRequestDto,
	IdpSigningEcCurve,
	IdpSigningKeyFamily,
	IdpSigningRsaModulusBits,
} from '@nestidp/shared';
import { IDP_CERT_EC_CURVES, IDP_CERT_RSA_MODULUS_BITS } from '@nestidp/shared';

export class GenerateIdpSigningCertBodyDto implements GenerateIdpSigningCertRequestDto {
	@IsOptional()
	@IsIn(['rsa', 'ec'])
	keyFamily?: IdpSigningKeyFamily;

	@ValidateIf((body: GenerateIdpSigningCertBodyDto) => (body.keyFamily ?? 'rsa') === 'rsa')
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn(IDP_CERT_RSA_MODULUS_BITS)
	rsaModulusBits?: IdpSigningRsaModulusBits;

	@ValidateIf((body: GenerateIdpSigningCertBodyDto) => body.keyFamily === 'ec')
	@IsOptional()
	@IsIn(IDP_CERT_EC_CURVES)
	ecCurve?: IdpSigningEcCurve;

	@IsOptional()
	@IsString()
	signatureAlgorithmId?: string;

	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}
