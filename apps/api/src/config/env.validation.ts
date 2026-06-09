import { plainToInstance, Transform } from 'class-transformer';
import {
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	Max,
	MinLength,
	Min,
	validateSync,
} from 'class-validator';
import { MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS, validateDatabaseUrl } from '@nestidp/shared';

export enum NodeEnv {
	Development = 'development',
	Production = 'production',
	Test = 'test',
}

export class EnvironmentVariables {
	@IsString()
	@IsNotEmpty()
	DATABASE_URL!: string;

	/** At-rest DB encryption key (inline). Mutually exclusive with DATABASE_ENCRYPTION_KEY_FILE. */
	@IsOptional()
	@IsString()
	DATABASE_ENCRYPTION_KEY?: string;

	/** Path to a file containing the at-rest DB encryption key (Docker/K8s secret). */
	@IsOptional()
	@IsString()
	DATABASE_ENCRYPTION_KEY_FILE?: string;

	@IsString()
	@IsNotEmpty()
	SESSION_SECRET!: string;

	// §5.B11: enforce the secret-encryption key length at boot (the encryption util also checks ≥16, but
	// only at first encrypt — a too-short key must fail fast at startup, not mid-request).
	@IsString()
	@IsNotEmpty()
	@MinLength(16, { message: 'ENCRYPTION_KEY must be at least 16 characters' })
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
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(3600)
	@Max(MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS)
	ADMIN_SESSION_REMEMBER_TTL_SECONDS?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(1000)
	SYNC_HTTP_TIMEOUT_MS?: number;

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
	SYNC_STALE_RUN_MINUTES?: number;

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
	SYNC_MAX_USERS_PER_RUN?: number;

	/** Scheduled-sync tick interval (ms). `0` disables the in-process scheduler entirely. */
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	SYNC_SCHEDULER_TICK_MS?: number;

	/** Minimum allowed cron frequency (minutes); a schedule firing more often is rejected. */
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
	SYNC_SCHEDULE_MIN_INTERVAL_MINUTES?: number;

	/** Max random spread (seconds) added to each computed run; `0` = exact (no jitter). */
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	SYNC_SCHEDULE_JITTER_MAX_SECONDS?: number;

	/** N consecutive failed scheduled runs auto-pause the schedule; `0` = never auto-pause. */
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD?: number;

	/** On boot, an overdue schedule runs immediately only if overdue by ≤ this many minutes (`0` = never). */
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES?: number;

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
	END_USER_SESSION_TTL_SECONDS?: number;

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
	END_USER_LOGIN_RATE_LIMIT_MAX?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(1000)
	END_USER_LOGIN_RATE_LIMIT_WINDOW_MS?: number;

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
	END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(1000)
	END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS?: number;

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
	SAML_ASSERTION_TTL_SECONDS?: number;

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
	SAML_SESSION_TTL_SECONDS?: number;

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
	SAML_CLOCK_SKEW_SECONDS?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	SAML_SESSION_CLEANUP_INTERVAL_MS?: number;

	@IsOptional()
	@IsString()
	SAML_METADATA_INCLUDE_ACS?: string;

	// §5.B10: PORT must be a numeric string (a non-numeric value previously reached `Number(PORT)` → NaN →
	// `app.listen(NaN)`). 1–5 digits; the [1,65535] range is re-checked in main.ts.
	@IsOptional()
	@IsString()
	@Matches(/^[0-9]{1,5}$/, { message: 'PORT must be a numeric string (1–65535)' })
	PORT?: string;

	@IsOptional()
	@IsString()
	TRUST_PROXY?: string;

	@IsOptional()
	@IsString()
	MIGRATE_ONLY?: string;

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
	AUDIT_RETENTION_DAYS?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(0)
	AUDIT_CLEANUP_INTERVAL_MS?: number;

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
	ADMIN_USER_CREATE_RATE_LIMIT_MAX?: number;

	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	})
	@IsInt()
	@Min(1000)
	ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS?: number;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
	});
	const errors = validateSync(validated, { skipMissingProperties: false });
	if (errors.length > 0) {
		throw new Error(errors.toString());
	}
	validateDatabaseUrl(validated.DATABASE_URL);
	if (validated.DATABASE_ENCRYPTION_KEY && validated.DATABASE_ENCRYPTION_KEY_FILE) {
		throw new Error('Set only one of DATABASE_ENCRYPTION_KEY or DATABASE_ENCRYPTION_KEY_FILE');
	}
	if (
		validated.NODE_ENV === NodeEnv.Production &&
		!validated.DATABASE_ENCRYPTION_KEY &&
		!validated.DATABASE_ENCRYPTION_KEY_FILE
	) {
		throw new Error(
			'DATABASE_ENCRYPTION_KEY (or DATABASE_ENCRYPTION_KEY_FILE) is required in production',
		);
	}
	return validated;
}
