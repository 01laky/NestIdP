import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsIn,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	Max,
	Min,
} from 'class-validator';
import type {
	ConnectExternalDbRequest,
	DisconnectExternalDbRequest,
	ExternalDbConnectionInput,
	ExternalDbDialect,
	ExternalDbSslMode,
} from '@nestidp/shared';
import { EXTERNAL_DB_DIALECTS, EXTERNAL_DB_SSL_MODES } from '@nestidp/shared';

export class TestExternalDbBodyDto implements ExternalDbConnectionInput {
	@IsIn(EXTERNAL_DB_DIALECTS)
	dialect!: ExternalDbDialect;

	@IsString()
	@IsNotEmpty()
	host!: string;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	port!: number;

	@IsString()
	@IsNotEmpty()
	database!: string;

	@IsString()
	@IsNotEmpty()
	username!: string;

	@IsOptional()
	@IsString()
	password?: string;

	@IsIn(EXTERNAL_DB_SSL_MODES)
	sslMode!: ExternalDbSslMode;

	@IsOptional()
	@IsString()
	sslCaCertPem?: string | null;

	// Embedded in search_path / CREATE SCHEMA, so it must stay a plain identifier (PG_SCHEMA_PATTERN).
	@IsOptional()
	@IsString()
	@Matches(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, {
		message: 'pgSchema must be a plain PostgreSQL identifier (letters, digits, underscores)',
	})
	pgSchema?: string | null;
}

export class ConnectExternalDbBodyDto
	extends TestExternalDbBodyDto
	implements ConnectExternalDbRequest
{
	@IsOptional()
	@IsBoolean()
	keepLocalCopy?: boolean;

	@IsOptional()
	@IsBoolean()
	acknowledgeBackup?: boolean;
}

export class DisconnectExternalDbBodyDto implements DisconnectExternalDbRequest {
	@IsBoolean()
	moveDataToLocal!: boolean;

	@IsOptional()
	@IsBoolean()
	acknowledgeDataLoss?: boolean;
}
