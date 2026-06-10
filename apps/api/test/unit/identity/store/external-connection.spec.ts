import {
	type ExternalDbConfig,
	mysqlSslOption,
	pgSslOption,
	resolvePgSchema,
} from '@api/identity/store/external/external-connection';

function cfg(over: Partial<ExternalDbConfig>): ExternalDbConfig {
	return {
		dialect: 'postgres',
		host: 'h',
		port: 5432,
		database: 'd',
		username: 'u',
		password: 'p',
		sslMode: 'require',
		poolMax: 10,
		connectTimeoutMs: 5000,
		queryTimeoutMs: 10_000,
		...over,
	};
}

describe('TLS option mapping (TLS)', () => {
	it('TLS-PG-01: disable → false; require → encrypt without verify', () => {
		expect(pgSslOption(cfg({ sslMode: 'disable' }))).toBe(false);
		expect(pgSslOption(cfg({ sslMode: 'require' }))).toEqual({ rejectUnauthorized: false });
	});

	it('TLS-PG-02: verify-ca / verify-full → verify, with CA when provided', () => {
		expect(pgSslOption(cfg({ sslMode: 'verify-full' }))).toEqual({ rejectUnauthorized: true });
		expect(pgSslOption(cfg({ sslMode: 'verify-ca', sslCaCertPem: 'PEM' }))).toEqual({
			rejectUnauthorized: true,
			ca: 'PEM',
		});
	});

	it('TLS-MY-01: disable → undefined; require → encrypt without verify', () => {
		expect(mysqlSslOption(cfg({ sslMode: 'disable' }))).toBeUndefined();
		expect(mysqlSslOption(cfg({ sslMode: 'require' }))).toEqual({ rejectUnauthorized: false });
	});

	it('TLS-MY-02: verify modes carry the CA certificate when present', () => {
		expect(mysqlSslOption(cfg({ sslMode: 'verify-full', sslCaCertPem: 'CA' }))).toEqual({
			rejectUnauthorized: true,
			ca: 'CA',
		});
	});
});

describe('pgSchema resolution (PGSCHEMA)', () => {
	it('PGSCHEMA-01: empty/null/whitespace → null (default search_path, today’s behaviour)', () => {
		expect(resolvePgSchema(cfg({}))).toBeNull();
		expect(resolvePgSchema(cfg({ pgSchema: null }))).toBeNull();
		expect(resolvePgSchema(cfg({ pgSchema: '  ' }))).toBeNull();
	});

	it('PGSCHEMA-02: a plain identifier passes; anything else throws (it lands in search_path)', () => {
		expect(resolvePgSchema(cfg({ pgSchema: 'idp_test' }))).toBe('idp_test');
		for (const bad of ['idp test', 'idp;drop', 'a,b', '"x"', '1abc']) {
			expect(() => resolvePgSchema(cfg({ pgSchema: bad }))).toThrow('Invalid pgSchema');
		}
	});
});
