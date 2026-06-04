import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	IdpSigningEcCurve,
	IdpSigningKeyFamily,
	IdpSigningRsaModulusBits,
} from '@nestidp/shared';

export class StartIdpCertRotationBodyDto {
	@IsIn(['generate', 'upload'])
	mode!: 'generate' | 'upload';

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	signingCertPem?: string;

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	signingPrivateKeyPem?: string;

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@IsIn(['rsa', 'ec'])
	keyFamily?: IdpSigningKeyFamily;

	@ValidateIf(
		(body: StartIdpCertRotationBodyDto) =>
			body.mode === 'generate' && (body.keyFamily ?? 'rsa') === 'rsa',
	)
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@IsIn([2048, 3072, 4096])
	rsaModulusBits?: IdpSigningRsaModulusBits;

	@ValidateIf(
		(body: StartIdpCertRotationBodyDto) => body.mode === 'generate' && body.keyFamily === 'ec',
	)
	@IsOptional()
	@IsIn(['P-256', 'P-384', 'P-521'])
	ecCurve?: IdpSigningEcCurve;

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@IsString()
	signatureAlgorithmId?: string;

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}
