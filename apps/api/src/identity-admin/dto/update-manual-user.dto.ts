import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

export class UpdateManualIdentityUserBodyDto {
	@IsOptional()
	@Trim()
	@IsString()
	@MinLength(1)
	@MaxLength(128)
	username?: string;

	@IsOptional()
	@Trim()
	@IsString()
	@MaxLength(256)
	email?: string | null;

	@IsOptional()
	@Trim()
	@IsString()
	@MaxLength(256)
	displayName?: string | null;

	@IsOptional()
	@IsString()
	@MinLength(8)
	@MaxLength(256)
	password?: string;

	@IsOptional()
	@IsBoolean()
	active?: boolean;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(100)
	@IsString({ each: true })
	groupIds?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(100)
	@IsString({ each: true })
	roleIds?: string[];
}
