import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from '@/ui/ButtonLink';
import { evgButtonClasses } from '@/ui/button-classes';

describe('ButtonLink', () => {
	it('WEB-IDN-UI-53: default variant is primary evg-btn', () => {
		render(
			<MemoryRouter>
				<ButtonLink to="/admin/identity/users">Create</ButtonLink>
			</MemoryRouter>,
		);
		const link = screen.getByRole('link', { name: 'Create' });
		expect(link.className).toContain('evg-btn');
		expect(link.className).toContain('evg-btn--primary');
		expect(link.getAttribute('href')).toBe('/admin/identity/users');
	});

	it('WEB-IDN-UI-54: secondary and link variants', () => {
		render(
			<MemoryRouter>
				<>
					<ButtonLink to="/edit" variant="secondary">
						Edit
					</ButtonLink>
					<ButtonLink to="/back" variant="link">
						Back
					</ButtonLink>
				</>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Edit' }).className).toContain('evg-btn--secondary');
		expect(screen.getByRole('link', { name: 'Back' }).className).toContain('evg-btn--link');
	});

	it('WEB-IDN-UI-55: size sm and block classes', () => {
		render(
			<MemoryRouter>
				<ButtonLink to="/x" size="sm" block>
					Small block
				</ButtonLink>
			</MemoryRouter>,
		);
		const link = screen.getByRole('link', { name: 'Small block' });
		expect(link.className).toContain('evg-btn--sm');
		expect(link.className).toContain('evg-btn--block');
	});

	it('WEB-IDN-UI-56: merges custom className', () => {
		render(
			<MemoryRouter>
				<ButtonLink to="/x" className="extra-class">
					Extra
				</ButtonLink>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Extra' }).className).toContain('extra-class');
	});

	it('WEB-IDN-UI-57: evgButtonClasses matches Button class list', () => {
		expect(evgButtonClasses({ variant: 'danger', size: 'sm', block: true, className: 'x' })).toBe(
			'evg-btn evg-btn--danger evg-btn--sm evg-btn--block x',
		);
	});
});
