import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
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
}
