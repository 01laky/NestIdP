import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { I18N_NAMESPACES } from '@/i18n/namespaces';
import { i18nDir } from '@test/helpers/paths';

const localesDir = join(i18nDir, 'locales');

function collectKeyPaths(value: unknown, prefix = ''): string[] {
	const paths: string[] = [];
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			const next = prefix ? `${prefix}.${key}` : key;
			if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
				paths.push(...collectKeyPaths(child, next));
			} else {
				paths.push(next);
			}
		}
	}
	return paths.sort();
}

function parityErrors(enPaths: Set<string>, localeFile: string, data: unknown): string[] {
	const paths = new Set(collectKeyPaths(data));
	const errors: string[] = [];
	for (const key of enPaths) {
		if (!paths.has(key)) {
			errors.push(`${localeFile}: missing key ${key}`);
		}
	}
	for (const key of paths) {
		if (!enPaths.has(key)) {
			errors.push(`${localeFile}: extra key ${key}`);
		}
	}
	return errors;
}

describe('i18n key parity (WEB-I18N-75–78)', () => {
	const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<
		string,
		unknown
	>;
	const enPaths = new Set(collectKeyPaths(en));

	it('WEB-I18N-75: en.json top-level namespaces match I18N_NAMESPACES', () => {
		expect(Object.keys(en).sort()).toEqual([...I18N_NAMESPACES].sort());
	});

	it('WEB-I18N-76: every non-en locale file has identical key paths', () => {
		const localeFiles = readdirSync(localesDir).filter(
			(name) => name.endsWith('.json') && name !== 'en.json',
		);
		expect(localeFiles).toHaveLength(9);
		for (const file of localeFiles) {
			const data = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));
			expect(parityErrors(enPaths, file, data)).toEqual([]);
		}
	});

	it('WEB-I18N-77: parity helper detects deliberate missing key', () => {
		const broken = { ...en, common: { apply: 'Apply' } };
		const errors = parityErrors(enPaths, 'broken.json', broken);
		expect(errors.some((e) => e.includes('missing key'))).toBe(true);
	});

	it('WEB-I18N-78: parity helper detects extra key', () => {
		const broken = {
			...en,
			common: { ...(en.common as Record<string, unknown>), extraKey: 'x' },
		};
		const errors = parityErrors(enPaths, 'broken.json', broken);
		expect(errors.some((e) => e.includes('extra key'))).toBe(true);
	});
});
