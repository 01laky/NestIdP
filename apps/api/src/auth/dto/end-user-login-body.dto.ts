import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export class EndUserLoginBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
