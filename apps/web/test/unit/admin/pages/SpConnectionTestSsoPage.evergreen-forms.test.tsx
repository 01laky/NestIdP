import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { SpConnectionTestSsoPage } from '@/admin/pages/SpConnectionTestSsoPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SpConnectionTestSsoPage Evergreen forms', () => {
	it('WEB-SP-TEST-SSO-01: renders test SSO URL from API', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp-1',
			name: 'App',
			spEntityId: 'urn:sp:1',
			acsUrl: 'https://sp.example.com/acs',
			nameIdFormat: '',
			attributeMapping: null,
			active: true,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		vi.spyOn(adminApi, 'getSpConnectionTestSsoUrl').mockResolvedValue({
			ssoUrl: 'http://localhost:3000/saml/sso?SAMLRequest=abc',
			spEntityId: 'urn:sp:1',
			authnRequestId: '_test-1',
			signed: false,
			encrypted: false,
		});

		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp-1/test-sso`]}>
				<Routes>
					<Route
						path={`${SP_CONNECTION_ROUTE_PREFIX}/:id/test-sso`}
						element={<SpConnectionTestSsoPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(
				screen.getByDisplayValue('http://localhost:3000/saml/sso?SAMLRequest=abc'),
			).toBeDefined(),
		);
		expect(container.querySelector('textarea.evg-textarea')).not.toBeNull();
	});

	it('WEB-SP-TEST-SSO-02: signed toggle triggers refetch with signed=true', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp-1',
			name: 'App',
			spEntityId: 'urn:sp:1',
			acsUrl: 'https://sp.example.com/acs',
			nameIdFormat: '',
			attributeMapping: null,
			active: true,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		const testSsoSpy = vi
			.spyOn(adminApi, 'getSpConnectionTestSsoUrl')
			.mockResolvedValueOnce({
				ssoUrl: 'http://localhost:3000/saml/sso?SAMLRequest=plain',
				spEntityId: 'urn:sp:1',
				authnRequestId: '_test-1',
				signed: false,
				encrypted: false,
			})
			.mockResolvedValueOnce({
				ssoUrl: 'http://localhost:3000/saml/sso?SAMLRequest=signed',
				spEntityId: 'urn:sp:1',
				authnRequestId: '_test-2',
				signed: true,
				encrypted: false,
			});

		renderWithUi(
			<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp-1/test-sso`]}>
				<Routes>
					<Route
						path={`${SP_CONNECTION_ROUTE_PREFIX}/:id/test-sso`}
						element={<SpConnectionTestSsoPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(
				screen.getByDisplayValue('http://localhost:3000/saml/sso?SAMLRequest=plain'),
			).toBeDefined(),
		);
		fireEvent.click(screen.getByRole('checkbox', { name: 'Include signature' }));

		await waitFor(() => {
			expect(testSsoSpy).toHaveBeenLastCalledWith('sp-1', { signed: true, encrypted: false });
		});
	});
});
