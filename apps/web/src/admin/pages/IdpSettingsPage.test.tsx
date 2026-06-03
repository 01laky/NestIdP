import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '../../test/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { IdpSettingsPublicDto } from '@nestidp/shared';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { IdpSettingsPage } from './IdpSettingsPage';

const confirmMock = vi.fn();

function baseSettings(overrides: Partial<IdpSettingsPublicDto> = {}): IdpSettingsPublicDto {
	return {
		entityId: 'http://localhost:3000',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		hasSigningCertificate: true,
		signingCertFingerprintSha256: 'aa:bb:cc',
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		metadataUrl: 'http://localhost:3000/saml/metadata',
		ssoUrl: 'http://localhost:3000/saml/sso',
		idpBaseUrl: 'http://localhost:3000',
		rotation: {
			active: false,
			startedAt: null,
			hasPendingCertificate: false,
			pendingCertFingerprintSha256: null,
		},
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

function renderPage() {
	return renderWithUi(
		<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
			<Routes>
				<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	confirmMock.mockReturnValue(true);
	vi.stubGlobal('confirm', confirmMock);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	confirmMock.mockReset();
});

describe('IdpSettingsPage', () => {
	it('WEB-ADM-39: page loads settings and shows entity ID', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'IdP settings' })).toBeDefined();
			expect(screen.getByDisplayValue('http://localhost:3000')).toBeDefined();
		});
	});

	it('WEB-ADM-40: PATCH entity ID calls API with CSRF', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const updateSpy = vi
			.spyOn(adminApi, 'updateIdpSettings')
			.mockResolvedValue(baseSettings({ entityId: 'https://idp.example.com' }));

		renderPage();
		await waitFor(() => screen.getByDisplayValue('http://localhost:3000'));

		fireEvent.change(screen.getByLabelText('Entity ID'), {
			target: { value: 'https://idp.example.com' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save entity ID' }));

		await waitFor(() => {
			expect(updateSpy).toHaveBeenCalledWith({ entityId: 'https://idp.example.com' });
		});
	});

	it('WEB-ADM-41: shows rotation panel when rotation.active', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Certificate rotation' })).toBeDefined();
		});
	});

	it('WEB-ADM-42: complete rotation button calls API', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);
		const completeSpy = vi
			.spyOn(adminApi, 'completeIdpCertRotation')
			.mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));

		await waitFor(() => {
			expect(completeSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-43: cancel rotation calls API', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);
		const cancelSpy = vi.spyOn(adminApi, 'cancelIdpCertRotation').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Cancel rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));

		await waitFor(() => {
			expect(cancelSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-44: generate cert button calls API', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi
			.spyOn(adminApi, 'generateIdpSigningCert')
			.mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));

		await waitFor(() => {
			expect(generateSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-45: upload modal submits PEM fields', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const uploadSpy = vi.spyOn(adminApi, 'uploadIdpSigningCert').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Upload certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Upload certificate' }));

		fireEvent.change(screen.getByLabelText(/^Signing certificate PEM/), {
			target: { value: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----' },
		});
		fireEvent.change(screen.getByLabelText(/^Private key PEM/), {
			target: { value: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

		await waitFor(() => {
			expect(uploadSpy).toHaveBeenCalledWith({
				signingCertPem: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
				signingPrivateKeyPem: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
			});
		});
	});

	it('WEB-ADM-46: metadata preview renders XML snippet', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		vi.spyOn(adminApi, 'getIdpMetadataPreview').mockResolvedValue({
			xml: '<EntityDescriptor entityID="test"></EntityDescriptor>',
			contentType: 'application/xml',
		});

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Refresh preview' }));
		fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));

		await waitFor(() => {
			expect(screen.getByText(/EntityDescriptor entityID="test"/)).toBeDefined();
		});
	});

	it('WEB-ADM-47: copy metadata URL invokes clipboard or prompt fallback', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		Object.assign(navigator, { clipboard: { writeText } });
		const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

		renderPage();
		await waitFor(() => screen.getAllByRole('button', { name: 'Copy' }).length > 0);
		fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith('http://localhost:3000/saml/metadata');
			expect(promptSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-48: error banner on 409 rotation conflict', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		vi.spyOn(adminApi, 'startIdpCertRotation').mockRejectedValue(
			new adminApi.AdminApiError(409, 'Rotation already in progress'),
		);

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Start rotation (generate)' }));
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Rotation already in progress');
		});
	});

	it('WEB-ADM-49: loading state on mount', () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockImplementation(
			() =>
				new Promise(() => {
					/* never resolves */
				}),
		);

		renderPage();
		expect(screen.getByText(/Loading IdP settings/i)).toBeDefined();
	});

	it('WEB-ADM-50: document.title set via header', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const previous = document.title;

		renderPage();
		await waitFor(() => {
			expect(document.title).toBe('IdP settings — NestIdP Admin');
		});

		cleanup();
		document.title = previous;
	});

	it('WEB-ADM-51: generate disabled during active rotation', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);

		renderPage();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Generate certificate' })).toHaveProperty(
				'disabled',
				true,
			);
		});
	});

	it('WEB-ADM-52: warning when entityId ≠ idpBaseUrl', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				entityId: 'https://custom-idp.example.com',
				idpBaseUrl: 'http://localhost:3000',
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain(
				'Entity ID differs from IDP_BASE_URL',
			);
		});
	});

	it('WEB-ADM-53: full flow load → start rotation → complete rotation', async () => {
		const inactive = baseSettings();
		const active = baseSettings({
			rotation: {
				active: true,
				startedAt: '2026-01-15T00:00:00.000Z',
				hasPendingCertificate: true,
				pendingCertFingerprintSha256: 'dd:ee:ff',
			},
		});

		vi.spyOn(adminApi, 'getIdpSettings')
			.mockResolvedValueOnce(inactive)
			.mockResolvedValueOnce(active)
			.mockResolvedValue(inactive);
		const startSpy = vi.spyOn(adminApi, 'startIdpCertRotation').mockResolvedValue(active);
		const completeSpy = vi.spyOn(adminApi, 'completeIdpCertRotation').mockResolvedValue(inactive);

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Start rotation (generate)' }));
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));

		await waitFor(() => {
			expect(startSpy).toHaveBeenCalledWith({ mode: 'generate' });
			expect(screen.getByRole('heading', { name: 'Certificate rotation' })).toBeDefined();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));

		await waitFor(() => {
			expect(completeSpy).toHaveBeenCalledTimes(1);
			expect(screen.getAllByText(/Certificate rotation completed/i).length).toBeGreaterThan(0);
		});
	});

	it('WEB-ADM-54: generate confirm false skips API', async () => {
		confirmMock.mockReturnValue(false);
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi.spyOn(adminApi, 'generateIdpSigningCert');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));

		expect(generateSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-55: upload confirm false skips API', async () => {
		confirmMock.mockReturnValue(false);
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const uploadSpy = vi.spyOn(adminApi, 'uploadIdpSigningCert');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Upload certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Upload certificate' }));

		fireEvent.change(screen.getByLabelText(/^Signing certificate PEM/), {
			target: { value: 'cert-pem' },
		});
		fireEvent.change(screen.getByLabelText(/^Private key PEM/), {
			target: { value: 'key-pem' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-56: complete rotation confirm false skips API', async () => {
		confirmMock.mockReturnValue(false);
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);
		const completeSpy = vi.spyOn(adminApi, 'completeIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));

		expect(completeSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-57: cancel rotation confirm false skips API', async () => {
		confirmMock.mockReturnValue(false);
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);
		const cancelSpy = vi.spyOn(adminApi, 'cancelIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Cancel rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));

		expect(cancelSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-58: expiry warning banner when signingCertNotAfter within 30 days', async () => {
		const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({ signingCertNotAfter: soon }),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText(/Signing certificate expires on/i)).toBeDefined();
		});
	});

	it('WEB-ADM-59: stale rotation banner when rotation.startedAt older than 7 days', async () => {
		const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: stale,
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText(/complete cutover or cancel/i)).toBeDefined();
		});
	});

	it('WEB-ADM-60: rotation panel renders numbered checklist (4 steps)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);

		renderPage();

		await waitFor(() => {
			const checklist = document.querySelector('.evg-checklist');
			expect(checklist).not.toBeNull();
			expect(checklist!.querySelectorAll('li').length).toBe(4);
		});
	});

	it('WEB-ADM-66: breadcrumbs show Dashboard and IdP settings', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());

		renderPage();

		await waitFor(() => {
			const crumb = screen.getByLabelText('Breadcrumb');
			expect(crumb.textContent).toContain('Dashboard');
			expect(crumb.textContent).toContain('IdP settings');
		});
	});

	it('WEB-ADM-67: start rotation confirm false skips API', async () => {
		confirmMock.mockReturnValue(false);
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const startSpy = vi.spyOn(adminApi, 'startIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Start rotation (generate)' }));
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));

		expect(startSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-68: production lazy-generation callout visible', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());

		renderPage();

		await waitFor(() => {
			expect(
				screen.getByText(/operators should configure signing material explicitly in production/i),
			).toBeDefined();
		});
	});

	it('WEB-ADM-69: upload button disabled during active rotation', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: {
					active: true,
					startedAt: '2026-01-15T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'dd:ee:ff',
				},
			}),
		);

		renderPage();

		await waitFor(() => {
			const uploadBtn = screen.getByRole('button', { name: 'Upload certificate' });
			expect((uploadBtn as HTMLButtonElement).disabled).toBe(true);
		});
	});
});
