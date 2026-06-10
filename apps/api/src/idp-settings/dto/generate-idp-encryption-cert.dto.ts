import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	GenerateIdpEncryptionCertRequestDto,
	IdpCertEcCurve,
	IdpCertKeyFamily,
	IdpCertRsaModulusBits,
} from '@nestidp/shared';
import { IDP_CERT_EC_CURVES, IDP_CERT_RSA_MODULUS_BITS } from '@nestidp/shared';

export class GenerateIdpEncryptionCertBodyDto implements GenerateIdpEncryptionCertRequestDto {
	@IsOptional()
	@IsIn(['rsa', 'ec'])
	keyFamily?: IdpCertKeyFamily;

	@ValidateIf((o) => o.keyFamily === 'rsa' || o.keyFamily === undefined)
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn(IDP_CERT_RSA_MODULUS_BITS)
	rsaModulusBits?: IdpCertRsaModulusBits;

	@ValidateIf((o) => o.keyFamily === 'ec')
	@IsOptional()
	@IsIn(IDP_CERT_EC_CURVES)
	ecCurve?: IdpCertEcCurve;

	@ValidateIf((o) => o.keyFamily === 'rsa' || o.keyFamily === undefined)
	@IsOptional()
	@IsString()
	keyTransportAlgorithmId?: string;

	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}
