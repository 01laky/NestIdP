import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttributeMappingEditor } from './AttributeMappingEditor';

afterEach(() => {
	cleanup();
});

describe('AttributeMappingEditor — extended edge cases', () => {
	it('WEB-EVG-133: preset email-nameid applies mapping to parent', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={null} onChange={onChange} />);
		fireEvent.change(screen.getByLabelText(/^Preset/), { target: { value: 'email-nameid' } });
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				nameId: { source: 'email' },
			}),
		);
	});

	it('WEB-EVG-134: NameID source select sets username', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={null} onChange={onChange} />);
		fireEvent.change(screen.getByLabelText(/^NameID source/), {
			target: { value: 'username' },
		});
		expect(onChange).toHaveBeenCalledWith({ nameId: { source: 'username' } });
	});

	it('WEB-EVG-135: clearing JSON textarea calls onChange(null)', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={{ nameId: { source: 'email' } }} onChange={onChange} />);
		fireEvent.change(screen.getByLabelText(/JSON \(advanced\)/), { target: { value: '' } });
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it('WEB-EVG-136: invalid JSON does not call onChange', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={null} onChange={onChange} />);
		onChange.mockClear();
		fireEvent.change(screen.getByLabelText(/JSON \(advanced\)/), {
			target: { value: '{not-json' },
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it('WEB-EVG-137: disabled prop disables Fieldset', () => {
		const { container } = render(
			<AttributeMappingEditor value={null} onChange={() => {}} disabled />,
		);
		expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
	});

	it('WEB-EVG-138: NameID source default clears nameId from mapping', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={{ nameId: { source: 'email' } }} onChange={onChange} />);
		fireEvent.change(screen.getByLabelText(/^NameID source/), { target: { value: '' } });
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it('WEB-EVG-139: preset username-groups includes groups attribute', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={null} onChange={onChange} />);
		fireEvent.change(screen.getByLabelText(/^Preset/), { target: { value: 'username-groups' } });
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				attributes: expect.arrayContaining([expect.objectContaining({ samlName: 'groups' })]),
			}),
		);
	});
});
