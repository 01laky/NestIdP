import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	IdpSigningEcCurve,
	IdpSigningKeyFamily,
	IdpSigningRsaModulusBits,
	StartIdpCertRotationRequestDto,
} from '@nestidp/shared';
import { IDP_CERT_EC_CURVES, IDP_CERT_RSA_MODULUS_BITS } from '@nestidp/shared';

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
	@IsIn(IDP_CERT_RSA_MODULUS_BITS)
	rsaModulusBits?: IdpSigningRsaModulusBits;

	@ValidateIf(
		(body: StartIdpCertRotationBodyDto) => body.mode === 'generate' && body.keyFamily === 'ec',
	)
	@IsOptional()
	@IsIn(IDP_CERT_EC_CURVES)
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

/**
 * §6.3: typed narrowing instead of a blind `as` cast — builds the correct member of the shared
 * discriminated union. Under `mode: 'upload'` the `@ValidateIf` rules guarantee both PEMs; the `''`
 * fallback is only reachable if validation was bypassed, and the service rejects an empty PEM the
 * same way as a missing one.
 */
export function toStartIdpCertRotationRequest(
	body: StartIdpCertRotationBodyDto,
): StartIdpCertRotationRequestDto {
	if (body.mode === 'upload') {
		return {
			mode: 'upload',
			signingCertPem: body.signingCertPem ?? '',
			signingPrivateKeyPem: body.signingPrivateKeyPem ?? '',
		};
	}
	return {
		mode: 'generate',
		keyFamily: body.keyFamily,
		rsaModulusBits: body.rsaModulusBits,
		ecCurve: body.ecCurve,
		signatureAlgorithmId: body.signatureAlgorithmId,
		notAfter: body.notAfter,
	};
}
