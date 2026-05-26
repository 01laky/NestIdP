import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	assertDatabaseConfig,
	resolveDatabaseProvider,
	syncPrismaSchemaProvider,
} from './database.config';

describe('database.config', () => {
	describe('resolveDatabaseProvider', () => {
		it('defaults to sqlite when unset', () => {
			expect(resolveDatabaseProvider(undefined)).toBe('sqlite');
		});

		it('accepts postgresql', () => {
			expect(resolveDatabaseProvider('postgresql')).toBe('postgresql');
		});

		it('rejects unknown providers', () => {
			expect(() => resolveDatabaseProvider('mysql')).toThrow(/DATABASE_PROVIDER/);
		});
	});

	describe('assertDatabaseConfig', () => {
		it('accepts sqlite file URLs', () => {
			expect(() => assertDatabaseConfig('sqlite', 'file:../data/nestidp.db')).not.toThrow();
		});

		it('rejects non-file URLs for sqlite', () => {
			expect(() => assertDatabaseConfig('sqlite', 'postgresql://localhost/db')).toThrow(/file:/);
		});

		it('accepts postgresql URLs', () => {
			expect(() =>
				assertDatabaseConfig('postgresql', 'postgresql://localhost:5432/nestidp'),
			).not.toThrow();
		});

		it('rejects sqlite URLs for postgresql provider', () => {
			expect(() => assertDatabaseConfig('postgresql', 'file:./dev.db')).toThrow(/postgresql/);
		});
	});

	describe('syncPrismaSchemaProvider', () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), 'nestidp-prisma-'));
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it('updates provider in a schema file', () => {
			const schemaPath = join(tempDir, 'schema.prisma');
			writeFileSync(
				schemaPath,
				`datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}\n`,
			);
			syncPrismaSchemaProvider(schemaPath, 'postgresql');
			expect(readFileSync(schemaPath, 'utf8')).toContain('provider = "postgresql"');
		});
	});
});
