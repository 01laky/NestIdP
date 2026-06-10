import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PEM_LENGTH } from '../../common/constants/crypto-limits';

export class ProbeSpSigningBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(MAX_PEM_LENGTH)
	spPrivateKeyPem!: string;
}
