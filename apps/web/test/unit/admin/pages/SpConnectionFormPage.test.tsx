import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { SpConnectionFormPage } from '@/admin/pages/SpConnectionFormPage';

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
				wantAssertionsEncrypted: false,
				wantAuthnRequestsSigned: false,
				wantLogoutRequestsSigned: false,
				sloUrl: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		});

		const { container } = renderNew();
		const form = container.querySelector('form');
		expect(form).not.toBeNull();
		fireEvent.change(form!.querySelector('input[name="name"]')!, { target: { value: 'New App' } });
		fireEvent.change(form!.querySelector('input[name="spEntityId"]')!, {
			target: { value: 'urn:sp:new' },
		});
		fireEvent.change(form!.querySelector('input[name="acsUrl"]')!, {
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
		fireEvent.change(form!.querySelector('input[name="name"]')!, { target: { value: 'Dup' } });
		fireEvent.change(form!.querySelector('input[name="spEntityId"]')!, {
			target: { value: 'urn:sp:dup' },
		});
		fireEvent.change(form!.querySelector('input[name="acsUrl"]')!, {
			target: { value: 'https://sp.example.com/acs' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Name already exists');
		});
	});

	it('WEB-SP-ENC-01: wantAssertionsEncrypted checkbox disabled without SP certificate PEM', async () => {
		const { container } = renderNew();
		await waitFor(() => container.querySelector('#encrypt-saml-assertions'));
		const checkbox = container.querySelector('#encrypt-saml-assertions') as HTMLInputElement;
		expect(checkbox.disabled).toBe(true);
	});

	it('WEB-SP-ENC-02: wantAssertionsEncrypted enabled when SP certificate PEM entered', async () => {
		const { container } = renderNew();
		const pem = await waitFor(() =>
			container.querySelector('[id="sp-certificate-pem-(optional)"]'),
		);
		fireEvent.change(pem!, {
			target: { value: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----' },
		});
		const checkbox = await waitFor(() => {
			const el = container.querySelector('#encrypt-saml-assertions') as HTMLInputElement;
			if (el.disabled) {
				throw new Error('still disabled');
			}
			return el;
		});
		fireEvent.click(checkbox);
		expect(checkbox.checked).toBe(true);
	});

	it('WEB-SP-REQ-SIG-01: wantAuthnRequestsSigned checkbox disabled without SP certificate PEM', () => {
		renderNew();
		const checkbox = screen.getByRole('checkbox', { name: /Require signed AuthnRequest/i });
		expect(checkbox).toHaveProperty('disabled', true);
	});

	it('WEB-SP-REQ-SIG-02: wantAuthnRequestsSigned checkbox enabled with SP certificate', async () => {
		const { container } = renderNew();
		const pemField = container.querySelector('[id="sp-certificate-pem-(optional)"]');
		expect(pemField).not.toBeNull();
		fireEvent.change(pemField!, {
			target: { value: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----' },
		});
		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /Require signed AuthnRequest/i })).toHaveProperty(
				'disabled',
				false,
			);
		});
	});

	it('WEB-SP-PROBE-SIG-01: probe signing panel appears after SP certificate is provided', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp-1',
			name: 'App',
			spEntityId: 'urn:sp:1',
			acsUrl: 'https://sp.example.com/acs',
			nameIdFormat: '',
			attributeMapping: null,
			active: true,
			hasSpCertificate: true,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sp-connections/sp-1']}>
				<Routes>
					<Route path="/admin/sp-connections/:id" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Probe SP signing key')).toBeDefined();
		});
	});
});
