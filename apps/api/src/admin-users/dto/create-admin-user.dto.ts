import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { CreateAdminUserRequestDto } from '@nestidp/shared';

export class CreateAdminUserBodyDto implements CreateAdminUserRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	username!: string;

	// bcrypt silently truncates input at 72 bytes — reject longer new passwords instead of storing a
	// silently-truncated one (72 chars == 72 bytes for ASCII).
	@IsString()
	@IsNotEmpty()
	@MaxLength(72)
	password!: string;
}
