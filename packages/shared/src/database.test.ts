import { describe, expect, it } from 'vitest';
import {
	DATABASE_PROVIDERS,
	DEFAULT_DATABASE_PROVIDER,
	isDatabaseProvider,
	validateDatabaseUrlForProvider,
} from './database.js';

describe('database providers', () => {
	it('defaults development to sqlite', () => {
		expect(DEFAULT_DATABASE_PROVIDER).toBe('sqlite');
	});

	it('lists sqlite and postgresql as supported providers', () => {
		expect(DATABASE_PROVIDERS).toEqual(['sqlite', 'postgresql']);
	});

	it('type-guards known providers', () => {
		expect(isDatabaseProvider('sqlite')).toBe(true);
		expect(isDatabaseProvider('postgresql')).toBe(true);
		expect(isDatabaseProvider('mysql')).toBe(false);
	});
});

describe('validateDatabaseUrlForProvider', () => {
	it('requires file: scheme for sqlite', () => {
		expect(() => validateDatabaseUrlForProvider('sqlite', 'file:./data.db')).not.toThrow();
		expect(() => validateDatabaseUrlForProvider('sqlite', 'postgresql://x')).toThrow(/file:/);
	});

	it('requires postgres scheme for postgresql', () => {
		expect(() =>
			validateDatabaseUrlForProvider('postgresql', 'postgresql://localhost/db'),
		).not.toThrow();
		expect(() =>
			validateDatabaseUrlForProvider('postgresql', 'postgres://localhost/db'),
		).not.toThrow();
		expect(() => validateDatabaseUrlForProvider('postgresql', 'file:./x')).toThrow(/postgresql/);
	});
});
