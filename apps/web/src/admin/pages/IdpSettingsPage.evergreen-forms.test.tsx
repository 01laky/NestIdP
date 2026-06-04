import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { IdpSettingsPublicDto } from '@nestidp/shared';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { renderWithUi } from '../../test/renderWithUi';
import { IdpSettingsPage } from './IdpSettingsPage';

function baseSettings(overrides: Partial<IdpSettingsPublicDto> = {}): IdpSettingsPublicDto {
	return {
		entityId: 'http://localhost:3000',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		hasSigningCertificate: true,
		signingCertFingerprintSha256: 'aa:bb',
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		signingKeyFamily: 'rsa',
		signingSignatureAlgorithmId: 'rsa-sha256',
		signingRsaModulusBits: 2048,
		signingEcCurve: null,
		metadataUrl: 'http://localhost:3000/saml/metadata',
		ssoUrl: 'http://localhost:3000/saml/sso',
		idpBaseUrl: 'http://localhost:3000',
		rotation: {
			active: false,
			startedAt: null,
			hasPendingCertificate: false,
			pendingCertFingerprintSha256: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			pendingSigningCertNotAfter: null,
		},
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('IdpSettingsPage Evergreen forms', () => {
	it('WEB-EVG-78: Save entity ID uses primary Button', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		renderWithUi(
			<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Save entity ID' }));
		expect(screen.getByRole('button', { name: 'Save entity ID' }).className).toContain(
			'evg-btn--primary',
		);
	});

	it('WEB-EVG-85: upload PEM TextArea pair when upload panel open', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		renderWithUi(
			<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Upload certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Upload certificate' }));
		expect(screen.getByLabelText(/Signing certificate PEM/i)).toBeDefined();
		expect(screen.getByLabelText(/Private key PEM/i)).toBeDefined();
	});

	it('WEB-EVG-97: rotation section uses Button variants when rotation active', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-01T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'cc:dd',
					pendingSigningKeyFamily: null,
					pendingSigningSignatureAlgorithmId: null,
					pendingSigningRsaModulusBits: null,
					pendingSigningEcCurve: null,
					pendingSigningCertNotAfter: null,
				},
			}),
		);
		renderWithUi(
			<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		expect(screen.getByRole('button', { name: 'Complete rotation' }).className).toContain(
			'evg-btn--primary',
		);
		expect(screen.getByRole('button', { name: 'Cancel rotation' }).className).toContain(
			'evg-btn--danger',
		);
	});
});
