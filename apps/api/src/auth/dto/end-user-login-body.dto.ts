import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export class EndUserLoginBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	@Trim()
	username!: string;

	// bcrypt (the only supported synced-hash algorithm) truncates input at 72 bytes — a longer password is
	// never a byte-exact match, so reject it with a clean 400 instead of comparing a truncated prefix.
	@IsString()
	@IsNotEmpty()
	@MaxLength(72)
	password!: string;

	@IsOptional()
	@IsString()
	@Matches(CUID_PATTERN, { message: 'Invalid samlSessionId' })
	samlSessionId?: string;
}
