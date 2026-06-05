import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { CreateAdminUserRequestDto } from '@nestidp/shared';

export class CreateAdminUserBodyDto implements CreateAdminUserRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	username!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	password!: string;
}
