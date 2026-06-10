import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { UpdateAdminUserRequestDto } from '@nestidp/shared';

export class UpdateAdminUserBodyDto implements UpdateAdminUserRequestDto {
	// bcrypt silently truncates input at 72 bytes — reject longer new passwords instead of storing a
	// silently-truncated one (72 chars == 72 bytes for ASCII).
	@IsString()
	@IsNotEmpty()
	@MaxLength(72)
	password!: string;
}
