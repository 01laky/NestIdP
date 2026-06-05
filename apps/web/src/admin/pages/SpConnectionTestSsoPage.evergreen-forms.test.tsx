import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { renderWithUi } from '../../test/renderWithUi';
import { SpConnectionTestSsoPage } from './SpConnectionTestSsoPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SpConnectionTestSsoPage Evergreen forms', () => {
	it('WEB-EVG-98: command area uses TextArea', async () => {
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
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		vi.spyOn(adminApi, 'getIdpMetadataUrl').mockResolvedValue({
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
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

		await waitFor(() => screen.getByLabelText(/Command/i));
		expect(container.querySelector('textarea.evg-textarea')).not.toBeNull();
	});
});
