import { Transform } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from 'class-validator';

export class UpdateManualIdentityUserBodyDto {
	@IsOptional()
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@MinLength(1)
	@MaxLength(128)
	username?: string;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === null || value === undefined) {
			return value;
		}
		return typeof value === 'string' ? value.trim() : value;
	})
	@IsString()
	@MaxLength(256)
	email?: string | null;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === null || value === undefined) {
			return value;
		}
		return typeof value === 'string' ? value.trim() : value;
	})
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
