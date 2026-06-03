import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { AdminChangePasswordRequestDto } from '@nestidp/shared';

export class AdminChangePasswordBodyDto implements AdminChangePasswordRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	currentPassword!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	newPassword!: string;
}
