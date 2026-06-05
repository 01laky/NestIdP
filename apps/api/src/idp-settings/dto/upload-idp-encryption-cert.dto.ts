import { IsString } from 'class-validator';

export class UploadIdpEncryptionCertBodyDto {
	@IsString()
	encryptionCertPem!: string;

	@IsString()
	encryptionPrivateKeyPem!: string;
}
