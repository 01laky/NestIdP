import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttributeMappingEditor } from '@/admin/components/mapping/AttributeMappingEditor';

afterEach(() => {
	cleanup();
});

describe('AttributeMappingEditor', () => {
	it('WEB-ADM-27: applies preset mapping on select', () => {
		const onChange = vi.fn();
		render(<AttributeMappingEditor value={null} onChange={onChange} />);

		fireEvent.change(screen.getByLabelText(/Preset/i), {
			target: { value: 'email-nameid' },
		});

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				nameId: { source: 'email' },
			}),
		);
	});

	it('WEB-ADM-28: clearing NameID source removes nameId key', () => {
		const onChange = vi.fn();
		render(
			<AttributeMappingEditor
				value={{ nameId: { source: 'email' }, attributes: [] }}
				onChange={onChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/NameID source/i), {
			target: { value: '' },
		});

		expect(onChange).toHaveBeenCalledWith({ attributes: [] });
	});

	it('WEB-ADM-29: JSON textarea null clears mapping', () => {
		const onChange = vi.fn();
		render(
			<AttributeMappingEditor
				value={{ attributes: [{ samlName: 'uid', source: 'username' }] }}
				onChange={onChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/JSON/i), {
			target: { value: '' },
		});

		expect(onChange).toHaveBeenCalledWith(null);
	});
});
