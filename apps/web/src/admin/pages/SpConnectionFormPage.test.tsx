import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithUi } from '../../test/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { SpConnectionFormPage } from './SpConnectionFormPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigateMock.mockReset();
});

function renderNew() {
	return renderWithUi(
		<MemoryRouter initialEntries={['/admin/sp-connections/new']}>
			<Routes>
				<Route path="/admin/sp-connections/new" element={<SpConnectionFormPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('SpConnectionFormPage', () => {
	it('WEB-ADM-32: create submits createSpConnection', async () => {
		vi.spyOn(adminApi, 'createSpConnection').mockResolvedValue({
			item: {
				id: 'sp-new',
				name: 'New App',
				spEntityId: 'urn:sp:new',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				attributeMapping: null,
				active: true,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		});

		const { container } = renderNew();
		const form = container.querySelector('form');
		expect(form).not.toBeNull();
		fireEvent.change(within(form!).getByLabelText('Name'), { target: { value: 'New App' } });
		fireEvent.change(within(form!).getByLabelText('SP Entity ID'), {
			target: { value: 'urn:sp:new' },
		});
		fireEvent.change(within(form!).getByLabelText('ACS URL'), {
			target: { value: 'https://sp.example.com/acs' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(adminApi.createSpConnection).toHaveBeenCalled();
			expect(navigateMock).toHaveBeenCalledWith('/admin/sp-connections/sp-new');
		});
	});

	it('WEB-ADM-33: shows API error on failed save', async () => {
		vi.spyOn(adminApi, 'createSpConnection').mockRejectedValue(
			new adminApi.AdminApiError(409, 'Name already exists'),
		);

		const { container } = renderNew();
		const form = container.querySelector('form');
		expect(form).not.toBeNull();
		fireEvent.change(within(form!).getByLabelText('Name'), { target: { value: 'Dup' } });
		fireEvent.change(within(form!).getByLabelText('SP Entity ID'), {
			target: { value: 'urn:sp:dup' },
		});
		fireEvent.change(within(form!).getByLabelText('ACS URL'), {
			target: { value: 'https://sp.example.com/acs' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Name already exists');
		});
	});
});
