import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { AdminChangePasswordRequestDto } from '@nestidp/shared';

export class AdminChangePasswordBodyDto implements AdminChangePasswordRequestDto {
	// Deliberately wider than newPassword: a legacy password set before the 72-byte cap (bcrypt silently
	// truncated it at hash time) must still verify here so its owner can rotate it.
	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	currentPassword!: string;

	// bcrypt silently truncates input at 72 bytes — reject longer new passwords instead of storing a
	// silently-truncated one (72 chars == 72 bytes for ASCII).
	@IsString()
	@IsNotEmpty()
	@MaxLength(72)
	newPassword!: string;
}
