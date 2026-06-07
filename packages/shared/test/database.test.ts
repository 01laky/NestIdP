import { describe, expect, it } from 'vitest';
import { validateDatabaseUrl } from '@shared/database.js';

describe('validateDatabaseUrl', () => {
	it('SH-DB-01: accepts a file: URL', () => {
		expect(() => validateDatabaseUrl('file:./data/nestidp.db')).not.toThrow();
		expect(() => validateDatabaseUrl('file:/abs/path.db')).not.toThrow();
	});

	it('SH-DB-02: rejects empty', () => {
		expect(() => validateDatabaseUrl('')).toThrow(/must not be empty/);
		expect(() => validateDatabaseUrl('   ')).toThrow(/must not be empty/);
	});

	it('SH-DB-03: rejects non-file schemes (no more postgres/multi-provider)', () => {
		expect(() => validateDatabaseUrl('postgresql://localhost/db')).toThrow(/file:/);
		expect(() => validateDatabaseUrl('libsql://remote')).toThrow(/file:/);
	});

	it('SH-DB-04: rejects every other known scheme and bare paths', () => {
		for (const url of [
			'postgres://localhost/db',
			'mysql://localhost/db',
			'mongodb://localhost/db',
			'http://localhost/db',
			'https://localhost/db',
			'sqlite:./x.db',
			'./relative.db',
			'/absolute/path.db',
			'nestidp.db',
		]) {
			expect(() => validateDatabaseUrl(url)).toThrow(/file:/);
		}
	});

	it('SH-DB-05: scheme check is case-sensitive (FILE: / File: are rejected)', () => {
		expect(() => validateDatabaseUrl('FILE:./x.db')).toThrow(/file:/);
		expect(() => validateDatabaseUrl('File:./x.db')).toThrow(/file:/);
	});

	it('SH-DB-06: trims surrounding whitespace before validating', () => {
		expect(() => validateDatabaseUrl('  file:./x.db  ')).not.toThrow();
		expect(() => validateDatabaseUrl('\tfile:/abs.db\n')).not.toThrow();
		expect(() => validateDatabaseUrl('\n\t  ')).toThrow(/must not be empty/);
	});

	it('SH-DB-07: accepts bare and in-memory file URLs', () => {
		expect(() => validateDatabaseUrl('file:')).not.toThrow();
		expect(() => validateDatabaseUrl('file::memory:')).not.toThrow();
	});
});
