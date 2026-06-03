import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatorSessionBar } from './OperatorSessionBar';

afterEach(() => {
	cleanup();
});

describe('OperatorSessionBar', () => {
	it('WEB-EVG-13: shows username when provided', () => {
		render(
			<MemoryRouter>
				<OperatorSessionBar username="operator1" />
			</MemoryRouter>,
		);
		expect(screen.getByText(/Signed in as/i).textContent).toContain('operator1');
	});

	it('WEB-EVG-70: change-password link targets admin users hash anchor', () => {
		render(
			<MemoryRouter>
				<OperatorSessionBar username="ops" />
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Change password' }).getAttribute('href')).toBe(
			`${ADMIN_USERS_ROUTE_PREFIX}#change-password`,
		);
	});
});
