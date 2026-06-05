import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { UpdateAdminUserRequestDto } from '@nestidp/shared';

export class UpdateAdminUserBodyDto implements UpdateAdminUserRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	password!: string;
}
