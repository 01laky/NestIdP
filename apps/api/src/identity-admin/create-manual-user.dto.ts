import { Transform } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
	Validate,
	ValidatorConstraint,
	ValidatorConstraintInterface,
	ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'passwordsMatch', async: false })
class PasswordsMatchConstraint implements ValidatorConstraintInterface {
	validate(_value: unknown, args: ValidationArguments): boolean {
		const obj = args.object as CreateManualIdentityUserBodyDto;
		return obj.password === obj.confirmPassword;
	}

	defaultMessage(): string {
		return 'Passwords do not match';
	}
}

export class CreateManualIdentityUserBodyDto {
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@MinLength(1)
	@MaxLength(128)
	username!: string;

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

	@IsString()
	@MinLength(8)
	@MaxLength(256)
	password!: string;

	@IsString()
	@MinLength(8)
	@MaxLength(256)
	@Validate(PasswordsMatchConstraint)
	confirmPassword!: string;

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
