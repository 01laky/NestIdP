import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	GenerateIdpEncryptionCertRequestDto,
	IdpCertEcCurve,
	IdpCertKeyFamily,
	IdpCertRsaModulusBits,
} from '@nestidp/shared';

export class GenerateIdpEncryptionCertBodyDto implements GenerateIdpEncryptionCertRequestDto {
	@IsOptional()
	@IsIn(['rsa', 'ec'])
	keyFamily?: IdpCertKeyFamily;

	@ValidateIf((o) => o.keyFamily === 'rsa' || o.keyFamily === undefined)
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn([2048, 3072, 4096])
	rsaModulusBits?: IdpCertRsaModulusBits;

	@ValidateIf((o) => o.keyFamily === 'ec')
	@IsOptional()
	@IsIn(['P-256', 'P-384', 'P-521'])
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
