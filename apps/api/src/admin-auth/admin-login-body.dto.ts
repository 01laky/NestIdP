import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AdminLoginRequestDto } from '@nestidp/shared';

export class AdminLoginBodyDto implements AdminLoginRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	username!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	password!: string;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (value === true || value === 'true') {
			return true;
		}
		if (value === false || value === 'false') {
			return false;
		}
		return value;
	})
	@IsBoolean()
	rememberMe?: boolean;
}
