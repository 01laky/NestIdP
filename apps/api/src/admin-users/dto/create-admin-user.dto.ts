import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { CreateAdminUserRequestDto } from '@nestidp/shared';
import { Trim } from '../../common/decorators/trim.decorator';

export class CreateAdminUserBodyDto implements CreateAdminUserRequestDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Trim()
	username!: string;

	// bcrypt silently truncates input at 72 bytes — reject longer new passwords instead of storing a
	// silently-truncated one (72 chars == 72 bytes for ASCII).
	@IsString()
	@IsNotEmpty()
	@MaxLength(72)
	password!: string;
}
