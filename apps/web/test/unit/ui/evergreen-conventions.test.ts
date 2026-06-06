import { readdirSync, readFileSync, statSync } from 'node:fs';
import { webSrc } from '@test/helpers/paths';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
			!name.endsWith('.test.tsx')
		) {
			out.push(path);
		}
	}
	return out;
}

const legacyPatterns = [
	/\badmin-shell\b/,
	/\badmin-sidebar\b/,
	/className="layout"/,
	/className="card"/,
	/className="danger"/,
	/className="button-link"/,
	/#0f1419/i,
	/#3d7dd6/i,
];

describe('Evergreen conventions (static)', () => {
	it('WEB-EVG-38: no legacy admin/layout class names in apps/web/src', () => {
		const files = walkTsx(webSrc);
		const hits: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			for (const pattern of legacyPatterns) {
				if (pattern.test(text)) {
					hits.push(`${file} → ${pattern}`);
				}
			}
		}
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-39: admin pages and components import ui via barrel not deep paths', () => {
		const dirs = [join(webSrc, 'admin/pages'), join(webSrc, 'admin/components')];
		const files = dirs.flatMap((dir) => walkTsx(dir));
		const deepImports: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			if (/from ['"]\.\.\/\.\.\/ui\/[A-Z]/.test(text) || /from ['"]\.\.\/ui\/[A-Z]/.test(text)) {
				deepImports.push(file);
			}
		}
		expect(deepImports).toEqual([]);
	});

	it('WEB-EVG-88: extends barrel rule to admin/components (alias of WEB-EVG-39)', () => {
		const componentsDir = join(webSrc, 'admin/components');
		const files = walkTsx(componentsDir);
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			if (/from ['"]\.\.\/\.\.\/ui\/[A-Z]/.test(text)) {
				expect.fail(`deep import in ${file}`);
			}
		}
	});

	it('WEB-EVG-90: primary admin editor forms use evg-stack class', () => {
		const formPages = [
			'ApiConnectionFormPage.tsx',
			'SpConnectionFormPage.tsx',
			'AdminUsersPage.tsx',
			'ApiConnectionSyncPage.tsx',
		];
		for (const name of formPages) {
			const text = readFileSync(join(webSrc, 'admin/pages', name), 'utf8');
			expect(text).toMatch(/className="evg-stack"/);
		}
	});

	it('WEB-EVG-40: main entry imports evergreen index.css not legacy index.css', () => {
		const main = readFileSync(join(webSrc, 'main.tsx'), 'utf8');
		expect(main).toContain('./styles/evergreen/index.css');
		expect(main).not.toContain('./index.css');
	});
});
