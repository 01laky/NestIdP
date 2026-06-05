import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ProbeSpSigningBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(16384)
	spPrivateKeyPem!: string;
}
