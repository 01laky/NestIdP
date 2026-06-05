import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttributeMappingEditor } from '@/admin/components/mapping/AttributeMappingEditor';

afterEach(() => {
	cleanup();
});

describe('AttributeMappingEditor Evergreen forms', () => {
	it('WEB-EVG-83: JSON uses TextArea', () => {
		const { container } = render(<AttributeMappingEditor value={null} onChange={() => {}} />);
		expect(screen.getByLabelText(/JSON \(advanced\)/i)).toBeDefined();
		expect(container.querySelector('textarea.evg-textarea')).not.toBeNull();
	});

	it('WEB-EVG-102: root uses Fieldset not raw fieldset-only without component', () => {
		const { container } = render(<AttributeMappingEditor value={null} onChange={() => {}} />);
		const fieldsets = container.querySelectorAll('fieldset.evg-fieldset');
		expect(fieldsets.length).toBe(1);
		expect(screen.getByText('Attribute mapping')).toBeDefined();
	});
});
