import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type {
	IdpCertRsaModulusBits,
	StartIdpEncryptionCertRotationRequestDto,
} from '@nestidp/shared';
import { IDP_CERT_RSA_MODULUS_BITS } from '@nestidp/shared';

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
	@IsIn(IDP_CERT_RSA_MODULUS_BITS)
	rsaModulusBits?: IdpCertRsaModulusBits;

	@ValidateIf((body: StartIdpEncryptionCertRotationBodyDto) => body.mode === 'generate')
	@IsOptional()
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	notAfter?: string;
}

/**
 * §6.3: typed narrowing instead of a blind `as` cast — builds the correct member of the shared
 * discriminated union (see toStartIdpCertRotationRequest for the upload-mode `''` rationale).
 */
export function toStartIdpEncryptionCertRotationRequest(
	body: StartIdpEncryptionCertRotationBodyDto,
): StartIdpEncryptionCertRotationRequestDto {
	if (body.mode === 'upload') {
		return {
			mode: 'upload',
			encryptionCertPem: body.encryptionCertPem ?? '',
			encryptionPrivateKeyPem: body.encryptionPrivateKeyPem ?? '',
		};
	}
	return {
		mode: 'generate',
		rsaModulusBits: body.rsaModulusBits,
		notAfter: body.notAfter,
	};
}
