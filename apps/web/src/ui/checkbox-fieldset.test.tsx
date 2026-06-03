import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ui from './index';
import { Checkbox } from './Checkbox';
import { Fieldset } from './Fieldset';
import { TextInput } from './TextInput';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '../styles/evergreen');

afterEach(() => {
	cleanup();
});

describe('Checkbox and Fieldset primitives', () => {
	it('WEB-EVG-84: Checkbox toggles and exposes label', () => {
		const onChange = vi.fn();
		render(<Checkbox label="Dry run" checked={false} onChange={onChange} />);
		const box = screen.getByRole('checkbox', { name: 'Dry run' });
		fireEvent.click(box);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('WEB-EVG-95: ui/index.ts exports Checkbox', () => {
		expect(ui.Checkbox).toBeTypeOf('function');
		expect(ui.Fieldset).toBeTypeOf('function');
	});

	it('WEB-EVG-96: Checkbox focus-visible style in CSS', () => {
		const css = readFileSync(join(stylesDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-checkbox:focus-visible/);
	});

	it('WEB-EVG-100: Fieldset renders legend and evg-fieldset class', () => {
		const { container } = render(
			<Fieldset legend="Attribute mapping">
				<p>child</p>
			</Fieldset>,
		);
		expect(screen.getByText('Attribute mapping')).toBeDefined();
		expect(container.querySelector('fieldset.evg-fieldset')).not.toBeNull();
	});

	it('WEB-EVG-104: TextInput labelVisuallyHidden keeps label in DOM with evg-sr-only', () => {
		const { container } = render(
			<TextInput label="Search" labelVisuallyHidden value="" onChange={() => {}} />,
		);
		expect(screen.getByLabelText('Search')).toBeDefined();
		expect(container.querySelector('.evg-sr-only')).not.toBeNull();
	});
});
