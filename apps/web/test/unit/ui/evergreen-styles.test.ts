import { readFileSync } from 'node:fs';
import { evergreenDir } from '@test/helpers/paths';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Evergreen styles', () => {
	it('WEB-EVG-11: prefers-reduced-motion present in tokens stack', () => {
		const reset = readFileSync(join(evergreenDir, 'reset.css'), 'utf8');
		expect(reset).toContain('prefers-reduced-motion');
	});

	it('WEB-EVG-17: print.css imported from evergreen index', () => {
		const index = readFileSync(join(evergreenDir, 'index.css'), 'utf8');
		expect(index).toContain('print.css');
		expect(readFileSync(join(evergreenDir, 'print.css'), 'utf8').length).toBeGreaterThan(20);
	});

	it('WEB-EVG-58: print.css hides sidebar, topbar, and toast region', () => {
		const printCss = readFileSync(join(evergreenDir, 'print.css'), 'utf8');
		expect(printCss).toContain('.evg-sidebar');
		expect(printCss).toContain('.evg-topbar');
		expect(printCss).toContain('.evg-toast-region');
		expect(printCss).toMatch(/display:\s*none\s*!important/);
	});

	it('WEB-EVG-59: print.css expands main and table wrap for print layout', () => {
		const printCss = readFileSync(join(evergreenDir, 'print.css'), 'utf8');
		expect(printCss).toContain('.evg-main');
		expect(printCss).toContain('.evg-table-wrap');
		expect(printCss).toContain('overflow: visible');
	});

	it('WEB-EVG-107: components.css defines focus-visible on evg-input', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-input:focus-visible/);
		expect(css).toMatch(/\.evg-select:focus-visible/);
		expect(css).toMatch(/\.evg-textarea:focus-visible/);
	});

	it('WEB-EVG-CONF-43: tokens.css defines --evg-z-modal above toast and drawer', () => {
		const tokens = readFileSync(join(evergreenDir, 'tokens.css'), 'utf8');
		expect(tokens).toContain('--evg-z-modal: 60');
		expect(tokens).toContain('--evg-z-toast: 50');
		expect(tokens).toContain('--evg-z-drawer: 40');
	});

	it('WEB-EVG-CONF-44: components.css defines evg-modal BEM and mobile stacked footer', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toContain('.evg-modal');
		expect(css).toContain('.evg-modal__backdrop');
		expect(css).toContain('.evg-modal--warning');
		expect(css).toContain('.evg-modal--danger');
		expect(css).toMatch(/column-reverse/);
	});

	it('WEB-EVG-60: tokens.css does not ship dark theme (deferred v1.2)', () => {
		const tokens = readFileSync(join(evergreenDir, 'tokens.css'), 'utf8');
		expect(tokens).not.toMatch(/prefers-color-scheme:\s*dark/);
	});
});
