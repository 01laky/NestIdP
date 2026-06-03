import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..');

function walkTsx(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === 'node_modules' || name === 'test') {
				continue;
			}
			walkTsx(path, out);
		} else if (
			/\.(tsx|ts)$/.test(name) &&
			!name.endsWith('.test.ts') &&
			!name.endsWith('.test.tsx') &&
			!name.includes('.evergreen')
		) {
			out.push(path);
		}
	}
	return out;
}

const forbiddenControlPatterns = [
	{ tag: 'input', regex: /<input[\s>/]/ },
	{ tag: 'button', regex: /<button[\s>/]/ },
	{ tag: 'select', regex: /<select[\s>/]/ },
	{ tag: 'textarea', regex: /<textarea[\s>/]/ },
] as const;

function findForbiddenControls(files: string[]): string[] {
	const hits: string[] = [];
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		for (const { tag, regex } of forbiddenControlPatterns) {
			if (regex.test(text)) {
				hits.push(`${file} → <${tag}`);
			}
		}
	}
	return hits;
}

describe('Evergreen admin form controls (static)', () => {
	it('WEB-EVG-73: no raw input/select/textarea in admin/pages and admin/components', () => {
		const dirs = [join(webSrc, 'admin/pages'), join(webSrc, 'admin/components')];
		const files = dirs.flatMap((dir) => walkTsx(dir));
		const hits = findForbiddenControls(files).filter((h) => !h.includes('→ <button'));
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-74: no raw button in admin/pages and admin/components', () => {
		const dirs = [join(webSrc, 'admin/pages'), join(webSrc, 'admin/components')];
		const files = dirs.flatMap((dir) => walkTsx(dir));
		const hits = findForbiddenControls(files).filter((h) => h.includes('→ <button'));
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-89: authoritative forbidden control scan (pages + components)', () => {
		const dirs = [join(webSrc, 'admin/pages'), join(webSrc, 'admin/components')];
		const files = dirs.flatMap((dir) => walkTsx(dir));
		expect(findForbiddenControls(files)).toEqual([]);
	});

	it('WEB-EVG-106: no raw form controls in admin root layout modules', () => {
		const rootNames = ['AdminLayout.tsx', 'AdminLoginPage.tsx', 'AdminApp.tsx'];
		const files = rootNames
			.map((name) => join(webSrc, 'admin', name))
			.filter((path) => existsSync(path));
		expect(findForbiddenControls(files)).toEqual([]);
	});
});
