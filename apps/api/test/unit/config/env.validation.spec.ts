import { validateEnv, NodeEnv } from '@api/config/env.validation';

describe('validateEnv', () => {
	const validConfig = {
		DATABASE_URL: 'file:../data/nestidp.db',
		SESSION_SECRET: 'session-secret-min-16-chars',
		ENCRYPTION_KEY: 'encryption-key-min-16-chars',
		IDP_BASE_URL: 'http://localhost:3000',
		NODE_ENV: 'test',
	};

	it('accepts a complete valid configuration', () => {
		const result = validateEnv(validConfig);
		expect(result.NODE_ENV).toBe(NodeEnv.Test);
		expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
	});

	it('ENV-DB-01: rejects a non-file DATABASE_URL (no more multi-provider)', () => {
		expect(() =>
			validateEnv({ ...validConfig, DATABASE_URL: 'postgresql://localhost:5432/nestidp' }),
		).toThrow(/file:/);
	});

	it('ENV-DB-02: production requires a DB encryption key (inline or file)', () => {
		expect(() => validateEnv({ ...validConfig, NODE_ENV: 'production' })).toThrow(
			/DATABASE_ENCRYPTION_KEY/,
		);
		expect(() =>
			validateEnv({ ...validConfig, NODE_ENV: 'production', DATABASE_ENCRYPTION_KEY: 'k' }),
		).not.toThrow();
		expect(() =>
			validateEnv({
				...validConfig,
				NODE_ENV: 'production',
				DATABASE_ENCRYPTION_KEY_FILE: '/run/secrets/dbkey',
			}),
		).not.toThrow();
	});

	it('ENV-DB-03: non-production allows an unencrypted DB (no key)', () => {
		expect(() => validateEnv({ ...validConfig, NODE_ENV: 'development' })).not.toThrow();
	});

	it('ENV-DB-04: rejects setting both inline key and key file', () => {
		expect(() =>
			validateEnv({
				...validConfig,
				DATABASE_ENCRYPTION_KEY: 'k',
				DATABASE_ENCRYPTION_KEY_FILE: '/run/secrets/dbkey',
			}),
		).toThrow(/only one of/i);
	});

	it('ENV-DB-05: rejects a whitespace-only DATABASE_URL', () => {
		expect(() => validateEnv({ ...validConfig, DATABASE_URL: '   ' })).toThrow();
	});

	it('ENV-DB-06: rejects a non-file scheme even with a valid encryption key', () => {
		expect(() =>
			validateEnv({
				...validConfig,
				DATABASE_URL: 'libsql://remote',
				DATABASE_ENCRYPTION_KEY: 'k',
			}),
		).toThrow(/file:/);
	});

	it('ENV-DB-07: production with only a key FILE (no inline key) is accepted', () => {
		expect(() =>
			validateEnv({
				...validConfig,
				NODE_ENV: 'production',
				DATABASE_ENCRYPTION_KEY_FILE: '/run/secrets/dbkey',
			}),
		).not.toThrow();
	});

	it('ENV-DB-08: an empty-string key in production still fails the guard', () => {
		expect(() =>
			validateEnv({ ...validConfig, NODE_ENV: 'production', DATABASE_ENCRYPTION_KEY: '' }),
		).toThrow(/DATABASE_ENCRYPTION_KEY/);
	});

	it('accepts all supported NODE_ENV values', () => {
		expect(validateEnv({ ...validConfig, NODE_ENV: 'development' }).NODE_ENV).toBe(
			NodeEnv.Development,
		);
		expect(
			validateEnv({ ...validConfig, NODE_ENV: 'production', DATABASE_ENCRYPTION_KEY: 'k' })
				.NODE_ENV,
		).toBe(NodeEnv.Production);
		expect(validateEnv({ ...validConfig, NODE_ENV: 'test' }).NODE_ENV).toBe(NodeEnv.Test);
	});

	it('rejects missing DATABASE_URL', () => {
		const { DATABASE_URL, ...rest } = validConfig;
		void DATABASE_URL;
		expect(() => validateEnv(rest)).toThrow();
	});

	it('rejects empty DATABASE_URL', () => {
		expect(() => validateEnv({ ...validConfig, DATABASE_URL: '' })).toThrow();
	});

	it('rejects missing SESSION_SECRET', () => {
		const { SESSION_SECRET, ...rest } = validConfig;
		void SESSION_SECRET;
		expect(() => validateEnv(rest)).toThrow();
	});

	it('rejects empty SESSION_SECRET', () => {
		expect(() => validateEnv({ ...validConfig, SESSION_SECRET: '' })).toThrow();
	});

	it('rejects missing ENCRYPTION_KEY', () => {
		const { ENCRYPTION_KEY, ...rest } = validConfig;
		void ENCRYPTION_KEY;
		expect(() => validateEnv(rest)).toThrow();
	});

	it('rejects empty ENCRYPTION_KEY', () => {
		expect(() => validateEnv({ ...validConfig, ENCRYPTION_KEY: '' })).toThrow();
	});

	it('rejects missing IDP_BASE_URL', () => {
		const { IDP_BASE_URL, ...rest } = validConfig;
		void IDP_BASE_URL;
		expect(() => validateEnv(rest)).toThrow();
	});

	it('rejects empty IDP_BASE_URL', () => {
		expect(() => validateEnv({ ...validConfig, IDP_BASE_URL: '' })).toThrow();
	});

	it('rejects missing NODE_ENV', () => {
		const { NODE_ENV, ...rest } = validConfig;
		void NODE_ENV;
		expect(() => validateEnv(rest)).toThrow();
	});

	it('rejects invalid NODE_ENV', () => {
		expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging' })).toThrow();
	});

	it('rejects completely empty config', () => {
		expect(() => validateEnv({})).toThrow();
	});

	it('allows optional ADMIN_USERNAME and ADMIN_PASSWORD', () => {
		const result = validateEnv({
			...validConfig,
			ADMIN_USERNAME: 'admin',
			ADMIN_PASSWORD: 'changeme',
		});
		expect(result.ADMIN_USERNAME).toBe('admin');
		expect(result.ADMIN_PASSWORD).toBe('changeme');
	});

	it('allows optional PORT as string', () => {
		const result = validateEnv({ ...validConfig, PORT: '4000' });
		expect(result.PORT).toBe('4000');
	});

	it('does not require optional admin or port fields', () => {
		const result = validateEnv(validConfig);
		expect(result.ADMIN_USERNAME).toBeUndefined();
		expect(result.ADMIN_PASSWORD).toBeUndefined();
		expect(result.PORT).toBeUndefined();
	});

	it('allows optional ADMIN_SESSION_TTL_SECONDS as positive integer', () => {
		const result = validateEnv({ ...validConfig, ADMIN_SESSION_TTL_SECONDS: '3600' });
		expect(result.ADMIN_SESSION_TTL_SECONDS).toBe(3600);
	});

	it('rejects invalid ADMIN_SESSION_TTL_SECONDS', () => {
		expect(() => validateEnv({ ...validConfig, ADMIN_SESSION_TTL_SECONDS: '0' })).toThrow();
	});

	it('API-ENV-ADM-RM-01: accepts ADMIN_SESSION_REMEMBER_TTL_SECONDS', () => {
		const result = validateEnv({
			...validConfig,
			ADMIN_SESSION_REMEMBER_TTL_SECONDS: '2592000',
		});
		expect(result.ADMIN_SESSION_REMEMBER_TTL_SECONDS).toBe(2_592_000);
	});

	it('API-ENV-ADM-RM-02: rejects invalid ADMIN_SESSION_REMEMBER_TTL_SECONDS', () => {
		expect(() =>
			validateEnv({ ...validConfig, ADMIN_SESSION_REMEMBER_TTL_SECONDS: '0' }),
		).toThrow();
		expect(() =>
			validateEnv({ ...validConfig, ADMIN_SESSION_REMEMBER_TTL_SECONDS: 'nope' }),
		).toThrow();
	});

	it('API-ENV-ADM-RM-03: rejects ADMIN_SESSION_REMEMBER_TTL_SECONDS above 90 days', () => {
		expect(() =>
			validateEnv({ ...validConfig, ADMIN_SESSION_REMEMBER_TTL_SECONDS: '9000000' }),
		).toThrow();
	});

	it('accepts optional SYNC_HTTP_TIMEOUT_MS within range', () => {
		const result = validateEnv({ ...validConfig, SYNC_HTTP_TIMEOUT_MS: '15000' });
		expect(result.SYNC_HTTP_TIMEOUT_MS).toBe(15_000);
	});

	it('rejects SYNC_HTTP_TIMEOUT_MS below minimum', () => {
		expect(() => validateEnv({ ...validConfig, SYNC_HTTP_TIMEOUT_MS: '500' })).toThrow();
	});

	it('accepts optional SYNC_STALE_RUN_MINUTES and SYNC_MAX_USERS_PER_RUN', () => {
		const result = validateEnv({
			...validConfig,
			SYNC_STALE_RUN_MINUTES: '60',
			SYNC_MAX_USERS_PER_RUN: '5000',
		});
		expect(result.SYNC_STALE_RUN_MINUTES).toBe(60);
		expect(result.SYNC_MAX_USERS_PER_RUN).toBe(5000);
	});

	it('rejects invalid SYNC_MAX_USERS_PER_RUN', () => {
		expect(() => validateEnv({ ...validConfig, SYNC_MAX_USERS_PER_RUN: '0' })).toThrow();
	});

	it('allows optional END_USER_SESSION_TTL_SECONDS as positive integer', () => {
		const result = validateEnv({ ...validConfig, END_USER_SESSION_TTL_SECONDS: '7200' });
		expect(result.END_USER_SESSION_TTL_SECONDS).toBe(7200);
	});

	it('rejects invalid END_USER_SESSION_TTL_SECONDS', () => {
		expect(() => validateEnv({ ...validConfig, END_USER_SESSION_TTL_SECONDS: '0' })).toThrow();
	});

	it('allows optional END_USER_LOGIN_RATE_LIMIT_MAX and WINDOW_MS', () => {
		const result = validateEnv({
			...validConfig,
			END_USER_LOGIN_RATE_LIMIT_MAX: '20',
			END_USER_LOGIN_RATE_LIMIT_WINDOW_MS: '600000',
		});
		expect(result.END_USER_LOGIN_RATE_LIMIT_MAX).toBe(20);
		expect(result.END_USER_LOGIN_RATE_LIMIT_WINDOW_MS).toBe(600_000);
	});

	it('allows optional END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX and WINDOW_MS', () => {
		const result = validateEnv({
			...validConfig,
			END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX: '8',
			END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS: '900000',
		});
		expect(result.END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX).toBe(8);
		expect(result.END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS).toBe(900_000);
	});

	it('rejects END_USER_LOGIN_RATE_LIMIT_WINDOW_MS below minimum', () => {
		expect(() =>
			validateEnv({ ...validConfig, END_USER_LOGIN_RATE_LIMIT_WINDOW_MS: '500' }),
		).toThrow();
	});

	it('API-ENV-SAML-01: accepts optional SAML_ASSERTION_TTL_SECONDS', () => {
		const result = validateEnv({ ...validConfig, SAML_ASSERTION_TTL_SECONDS: '600' });
		expect(result.SAML_ASSERTION_TTL_SECONDS).toBe(600);
	});

	it('API-ENV-SAML-02: accepts SAML_SESSION_CLEANUP_INTERVAL_MS zero', () => {
		const result = validateEnv({ ...validConfig, SAML_SESSION_CLEANUP_INTERVAL_MS: '0' });
		expect(result.SAML_SESSION_CLEANUP_INTERVAL_MS).toBe(0);
	});

	it('API-ENV-SAML-03: rejects invalid SAML_CLOCK_SKEW_SECONDS', () => {
		expect(() => validateEnv({ ...validConfig, SAML_CLOCK_SKEW_SECONDS: '0' })).toThrow();
	});

	it('API-TRUST-ENV-01: accepts optional TRUST_PROXY true/1/false', () => {
		expect(validateEnv({ ...validConfig, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe('true');
		expect(validateEnv({ ...validConfig, TRUST_PROXY: '1' }).TRUST_PROXY).toBe('1');
		expect(validateEnv({ ...validConfig, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe('false');
	});

	it('API-DCK-MIG-01: accepts optional MIGRATE_ONLY 0 and 1', () => {
		expect(validateEnv({ ...validConfig, MIGRATE_ONLY: '0' }).MIGRATE_ONLY).toBe('0');
		expect(validateEnv({ ...validConfig, MIGRATE_ONLY: '1' }).MIGRATE_ONLY).toBe('1');
	});

	it('API-DCK-MIG-02: accepts arbitrary MIGRATE_ONLY string for entrypoint script', () => {
		expect(validateEnv({ ...validConfig, MIGRATE_ONLY: 'yes' }).MIGRATE_ONLY).toBe('yes');
	});

	it('API-AUD-ENV-01: accepts AUDIT_RETENTION_DAYS and AUDIT_CLEANUP_INTERVAL_MS', () => {
		const result = validateEnv({
			...validConfig,
			AUDIT_RETENTION_DAYS: '30',
			AUDIT_CLEANUP_INTERVAL_MS: '3600000',
		});
		expect(result.AUDIT_RETENTION_DAYS).toBe(30);
		expect(result.AUDIT_CLEANUP_INTERVAL_MS).toBe(3_600_000);
	});

	it('API-AUD-ENV-02: rejects AUDIT_RETENTION_DAYS below 1', () => {
		expect(() => validateEnv({ ...validConfig, AUDIT_RETENTION_DAYS: '0' })).toThrow();
	});

	it('API-ENV-ENC-01: rejects an ENCRYPTION_KEY shorter than 16 chars (§5.B11)', () => {
		expect(() => validateEnv({ ...validConfig, ENCRYPTION_KEY: 'short-key' })).toThrow(
			/ENCRYPTION_KEY/,
		);
	});

	it('API-ENV-ENC-02: accepts an ENCRYPTION_KEY of exactly 16 chars', () => {
		expect(() => validateEnv({ ...validConfig, ENCRYPTION_KEY: '0123456789abcdef' })).not.toThrow();
	});

	it('API-ENV-PORT-01: rejects a non-numeric PORT (§5.B10)', () => {
		expect(() => validateEnv({ ...validConfig, PORT: 'abc' })).toThrow(/PORT/);
		expect(() => validateEnv({ ...validConfig, PORT: '8080x' })).toThrow(/PORT/);
	});

	it('API-ENV-PORT-02: accepts a numeric PORT', () => {
		expect(validateEnv({ ...validConfig, PORT: '8080' }).PORT).toBe('8080');
	});

	it('API-ADM-USR-ENV-01: accepts admin user create rate limit env vars', () => {
		const result = validateEnv({
			...validConfig,
			ADMIN_USER_CREATE_RATE_LIMIT_MAX: '10',
			ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS: '60000',
		});
		expect(result.ADMIN_USER_CREATE_RATE_LIMIT_MAX).toBe(10);
		expect(result.ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS).toBe(60_000);
	});
});
