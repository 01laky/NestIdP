import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export class EndUserLoginBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	username!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(256)
	password!: string;

	@IsOptional()
	@IsString()
	@Matches(CUID_PATTERN, { message: 'Invalid samlSessionId' })
	samlSessionId?: string;
}
