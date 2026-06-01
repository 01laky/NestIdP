import { IsString, Matches } from 'class-validator';

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export class CompleteSsoBodyDto {
	@IsString()
	@Matches(CUID_PATTERN, { message: 'Invalid samlSessionId' })
	samlSessionId!: string;
}
