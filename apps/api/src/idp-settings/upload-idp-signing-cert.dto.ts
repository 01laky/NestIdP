import { IsString } from 'class-validator';

export class UploadIdpSigningCertBodyDto {
	@IsString()
	signingCertPem!: string;

	@IsString()
	signingPrivateKeyPem!: string;
}
