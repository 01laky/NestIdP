import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';
import { Fieldset } from './Fieldset';
import { TextInput } from './TextInput';

afterEach(() => {
	cleanup();
});

describe('Checkbox and Fieldset — extended edge cases', () => {
	it('WEB-EVG-109: Checkbox disabled sets native disabled and ignores change handler', () => {
		const onChange = vi.fn();
		render(<Checkbox label="Active" checked={false} onChange={onChange} disabled />);
		const box = screen.getByRole('checkbox', { name: 'Active' }) as HTMLInputElement;
		expect(box.disabled).toBe(true);
		fireEvent.change(box, { target: { checked: true } });
		expect(onChange).not.toHaveBeenCalled();
	});

	it('WEB-EVG-110: Checkbox renders optional hint', () => {
		const { container } = render(
			<Checkbox label="Dry run" checked onChange={() => {}} hint="No database writes" />,
		);
		expect(container.querySelector('.evg-field__hint')?.textContent).toBe('No database writes');
	});

	it('WEB-EVG-111: Checkbox custom id links label via htmlFor', () => {
		render(<Checkbox label="Flag" checked={false} onChange={() => {}} id="my-flag" />);
		const box = screen.getByRole('checkbox', { name: 'Flag' });
		expect(box.id).toBe('my-flag');
	});

	it('WEB-EVG-112: Checkbox uncheck calls onChange(false)', () => {
		const onChange = vi.fn();
		render(<Checkbox label="Active" checked onChange={onChange} />);
		fireEvent.click(screen.getByRole('checkbox', { name: 'Active' }));
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it('WEB-EVG-113: Fieldset disabled propagates to native fieldset', () => {
		const { container } = render(
			<Fieldset legend="Section" disabled>
				<input type="text" />
			</Fieldset>,
		);
		const fieldset = container.querySelector('fieldset');
		expect(fieldset?.hasAttribute('disabled')).toBe(true);
	});

	it('WEB-EVG-114: Fieldset legend is first child of fieldset', () => {
		const { container } = render(
			<Fieldset legend="Attribute mapping">
				<p data-testid="child">x</p>
			</Fieldset>,
		);
		const fieldset = container.querySelector('fieldset');
		expect(fieldset?.querySelector('legend')?.textContent).toBe('Attribute mapping');
		expect(screen.getByTestId('child')).toBeDefined();
	});

	it('WEB-EVG-115: TextInput without labelVisuallyHidden has visible label', () => {
		const { container } = render(<TextInput label="Name" value="" onChange={() => {}} />);
		expect(container.querySelector('.evg-sr-only')).toBeNull();
		expect(screen.getByText('Name')).toBeDefined();
	});

	it('WEB-EVG-116: TextInput requiredMark shows required hint in label', () => {
		render(<TextInput label="Name" value="" onChange={() => {}} requiredMark />);
		expect(screen.getByText(/\(required\)/)).toBeDefined();
	});

	it('WEB-EVG-117: TextInput error uses evg-field__error', () => {
		const { container } = render(
			<TextInput label="Name" value="" onChange={() => {}} error="Too short" />,
		);
		expect(container.querySelector('.evg-field__error')?.textContent).toBe('Too short');
	});

	it('WEB-EVG-118: Checkbox uses evg-checkbox and evg-field--checkbox classes', () => {
		const { container } = render(<Checkbox label="Active" checked onChange={() => {}} />);
		expect(container.querySelector('.evg-field--checkbox')).not.toBeNull();
		expect(container.querySelector('.evg-checkbox')).not.toBeNull();
	});
});
