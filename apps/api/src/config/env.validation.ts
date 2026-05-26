import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

export enum NodeEnv {
	Development = 'development',
	Production = 'production',
	Test = 'test',
}

export class EnvironmentVariables {
	@IsString()
	@IsNotEmpty()
	DATABASE_URL!: string;

	@IsString()
	@IsNotEmpty()
	SESSION_SECRET!: string;

	@IsString()
	@IsNotEmpty()
	ENCRYPTION_KEY!: string;

	@IsString()
	@IsNotEmpty()
	IDP_BASE_URL!: string;

	@IsEnum(NodeEnv)
	NODE_ENV!: NodeEnv;

	@IsOptional()
	@IsString()
	ADMIN_USERNAME?: string;

	@IsOptional()
	@IsString()
	ADMIN_PASSWORD?: string;

	@IsOptional()
	@IsString()
	PORT?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
	});
	const errors = validateSync(validated, { skipMissingProperties: false });
	if (errors.length > 0) {
		throw new Error(errors.toString());
	}
	return validated;
}
