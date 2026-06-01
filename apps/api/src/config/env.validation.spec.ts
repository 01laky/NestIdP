import { validateEnv, NodeEnv } from './env.validation';

describe('validateEnv', () => {
	const validConfig = {
		DATABASE_PROVIDER: 'sqlite',
		DATABASE_URL: 'file:../data/nestidp.db',
		SESSION_SECRET: 'session-secret-min-16-chars',
		ENCRYPTION_KEY: 'encryption-key-min-16-chars',
		IDP_BASE_URL: 'http://localhost:3000',
		NODE_ENV: 'test',
	};

	it('accepts a complete valid configuration', () => {
		const result = validateEnv(validConfig);
		expect(result.NODE_ENV).toBe(NodeEnv.Test);
		expect(result.DATABASE_PROVIDER).toBe('sqlite');
		expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
	});

	it('defaults DATABASE_PROVIDER to sqlite when omitted', () => {
		const { DATABASE_PROVIDER, ...rest } = validConfig;
		void DATABASE_PROVIDER;
		const result = validateEnv(rest);
		expect(result.DATABASE_PROVIDER).toBe('sqlite');
	});

	it('accepts postgresql provider with matching URL', () => {
		const result = validateEnv({
			...validConfig,
			DATABASE_PROVIDER: 'postgresql',
			DATABASE_URL: 'postgresql://localhost:5432/nestidp',
		});
		expect(result.DATABASE_PROVIDER).toBe('postgresql');
	});

	it('rejects sqlite URL with postgresql provider', () => {
		expect(() =>
			validateEnv({
				...validConfig,
				DATABASE_PROVIDER: 'postgresql',
				DATABASE_URL: 'file:../data/nestidp.db',
			}),
		).toThrow(/postgresql/);
	});

	it('rejects postgresql URL with sqlite provider', () => {
		expect(() =>
			validateEnv({
				...validConfig,
				DATABASE_PROVIDER: 'sqlite',
				DATABASE_URL: 'postgresql://localhost:5432/nestidp',
			}),
		).toThrow(/file:/);
	});

	it('rejects invalid DATABASE_PROVIDER', () => {
		expect(() => validateEnv({ ...validConfig, DATABASE_PROVIDER: 'mysql' })).toThrow();
	});

	it('accepts all supported NODE_ENV values', () => {
		expect(validateEnv({ ...validConfig, NODE_ENV: 'development' }).NODE_ENV).toBe(
			NodeEnv.Development,
		);
		expect(validateEnv({ ...validConfig, NODE_ENV: 'production' }).NODE_ENV).toBe(
			NodeEnv.Production,
		);
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
});
