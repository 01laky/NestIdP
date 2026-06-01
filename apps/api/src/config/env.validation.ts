import { plainToInstance, Transform } from 'class-transformer';
import {
	IsEnum,
	IsIn,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Min,
	validateSync,
} from 'class-validator';
import {
	DATABASE_PROVIDERS,
	DatabaseProvider,
	DEFAULT_DATABASE_PROVIDER,
	validateDatabaseUrlForProvider,
} from '@nestidp/shared';
import { resolveDatabaseProvider } from './database.config';

export enum NodeEnv {
	Development = 'development',
	Production = 'production',
	Test = 'test',
}

export class EnvironmentVariables {
	@IsIn([...DATABASE_PROVIDERS])
	@Transform(({ value }) => resolveDatabaseProvider(value))
	DATABASE_PROVIDER!: DatabaseProvider;

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
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(1)
	ADMIN_SESSION_TTL_SECONDS?: number;

	@IsOptional()
	@IsString()
	PORT?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
	const configWithDefaults = {
		DATABASE_PROVIDER: DEFAULT_DATABASE_PROVIDER,
		...config,
	};
	const validated = plainToInstance(EnvironmentVariables, configWithDefaults, {
		enableImplicitConversion: true,
	});
	const errors = validateSync(validated, { skipMissingProperties: false });
	if (errors.length > 0) {
		throw new Error(errors.toString());
	}
	validateDatabaseUrlForProvider(validated.DATABASE_PROVIDER, validated.DATABASE_URL);
	return validated;
}
