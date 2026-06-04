import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const adminRoot = dirname(fileURLToPath(import.meta.url));

function walkTsx(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			out.push(...walkTsx(full));
		} else if (name.endsWith('.tsx')) {
			out.push(full);
		}
	}
	return out;
}

describe('admin confirm static guards', () => {
	const files = walkTsx(adminRoot).filter((f) => !f.endsWith('.test.tsx'));

	it('WEB-EVG-CONF-10: no window.confirm in admin tsx', () => {
		const hits: string[] = [];
		for (const file of files) {
			if (readFileSync(file, 'utf8').includes('window.confirm')) {
				hits.push(file);
			}
		}
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-CONF-11: no window.prompt in admin tsx', () => {
		const hits: string[] = [];
		for (const file of files) {
			if (readFileSync(file, 'utf8').includes('window.prompt')) {
				hits.push(file);
			}
		}
		expect(hits).toEqual([]);
	});
});
