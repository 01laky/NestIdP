import { cleanup, render, screen } from '@testing-library/react';
import { evergreenDir } from '@test/helpers/paths';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Button } from '@/ui/Button';

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
