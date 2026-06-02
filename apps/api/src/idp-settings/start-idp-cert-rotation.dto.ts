import { IsIn, IsString, ValidateIf } from 'class-validator';

export class StartIdpCertRotationBodyDto {
	@IsIn(['generate', 'upload'])
	mode!: 'generate' | 'upload';

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	signingCertPem?: string;

	@ValidateIf((body: StartIdpCertRotationBodyDto) => body.mode === 'upload')
	@IsString()
	signingPrivateKeyPem?: string;
}
