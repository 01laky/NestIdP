import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Button } from './Button';

const evergreenDir = join(dirname(fileURLToPath(import.meta.url)), '../styles/evergreen');

afterEach(() => {
	cleanup();
});

describe('Button', () => {
	it('WEB-EVG-03: primary applies evg-btn--primary', () => {
		render(<Button variant="primary">Save</Button>);
		const btn = screen.getByRole('button', { name: 'Save' });
		expect(btn.className).toContain('evg-btn--primary');
		expect(btn.className).toContain('evg-btn');
	});

	it('WEB-EVG-12: focus-visible styles defined for .evg-btn', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toContain('.evg-btn:focus-visible');
	});
});
