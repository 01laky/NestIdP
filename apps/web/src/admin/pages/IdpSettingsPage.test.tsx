import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithUi } from '../../test/renderWithUi';
import {
	acceptDialogWithChallenge,
	clickDialogCancel,
	clickDialogConfirm,
} from '../../test/confirm-dialog-helpers';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { IdpSettingsPublicDto, IdpSigningRotationStatusDto } from '@nestidp/shared';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { IdpSettingsPage } from './IdpSettingsPage';

function inactiveRotation(): IdpSigningRotationStatusDto {
	return {
		active: false,
		startedAt: null,
		hasPendingCertificate: false,
		pendingCertFingerprintSha256: null,
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		pendingSigningCertNotAfter: null,
	};
}

function activeRotation(
	overrides: Partial<IdpSigningRotationStatusDto> = {},
): IdpSigningRotationStatusDto {
	return {
		active: true,
		startedAt: '2026-01-15T00:00:00.000Z',
		hasPendingCertificate: true,
		pendingCertFingerprintSha256: 'dd:ee:ff',
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		pendingSigningCertNotAfter: null,
		...overrides,
	};
}

function baseSettings(overrides: Partial<IdpSettingsPublicDto> = {}): IdpSettingsPublicDto {
	return {
		entityId: 'http://localhost:3000',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		hasSigningCertificate: true,
		signingCertFingerprintSha256: 'aa:bb:cc',
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		signingKeyFamily: 'rsa',
		signingSignatureAlgorithmId: 'rsa-sha256',
		signingRsaModulusBits: 2048,
		signingEcCurve: null,
		metadataUrl: 'http://localhost:3000/saml/metadata',
		ssoUrl: 'http://localhost:3000/saml/sso',
		idpBaseUrl: 'http://localhost:3000',
		rotation: inactiveRotation(),
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

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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
				rotation: activeRotation(),
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
				rotation: activeRotation(),
			}),
		);
		const completeSpy = vi
			.spyOn(adminApi, 'completeIdpCertRotation')
			.mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));
		await acceptDialogWithChallenge('COMPLETE', 'Complete rotation');

		await waitFor(() => {
			expect(completeSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-43: cancel rotation calls API', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);
		const cancelSpy = vi.spyOn(adminApi, 'cancelIdpCertRotation').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Cancel rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Cancel rotation');

		await waitFor(() => {
			expect(cancelSpy).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-CONF-01: generate cert dialog confirm calls API (was WEB-ADM-44)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi
			.spyOn(adminApi, 'generateIdpSigningCert')
			.mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		await acceptDialogWithChallenge('REPLACE', 'Generate certificate');

		await waitFor(() => {
			expect(generateSpy).toHaveBeenCalled();
			const body = generateSpy.mock.calls[0]?.[0];
			expect(body).toBeDefined();
			expect(body?.notAfter).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(body?.keyFamily).toBe('rsa');
		});
	});

	it('WEB-IDP-CRYPTO-03: generate POST body includes notAfter from form', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi
			.spyOn(adminApi, 'generateIdpSigningCert')
			.mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByLabelText(/Certificate expiry/i));
		const expiry = screen.getByLabelText(/Certificate expiry/i) as HTMLInputElement;
		fireEvent.change(expiry, { target: { value: '2029-03-20' } });
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		await acceptDialogWithChallenge('REPLACE', 'Generate certificate');

		await waitFor(() => {
			expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({ notAfter: '2029-03-20' }));
		});
	});

	it('WEB-IDP-CRYPTO-08: rotation panel shows pending crypto and expiry', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation({
					pendingSigningKeyFamily: 'ec',
					pendingSigningSignatureAlgorithmId: 'ecdsa-sha256',
					pendingSigningEcCurve: 'P-256',
					pendingSigningCertNotAfter: '2031-06-01T00:00:00.000Z',
				}),
			}),
		);

		renderPage();
		await waitFor(() => {
			expect(screen.getByText(/ecdsa-sha256/i)).toBeDefined();
			expect(screen.getByText(/2031-06-01/)).toBeDefined();
		});
	});

	it('WEB-IDP-CRYPTO-09: upload rotation shows algorithm mismatch callout', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				signingSignatureAlgorithmId: 'rsa-sha256',
				rotation: activeRotation({
					pendingSigningKeyFamily: 'rsa',
					pendingSigningSignatureAlgorithmId: 'rsa-sha512',
					pendingSigningRsaModulusBits: 2048,
					pendingSigningCertNotAfter: '2031-01-01T00:00:00.000Z',
				}),
			}),
		);

		renderPage();
		await waitFor(() => {
			expect(
				screen.getByText(/different signature algorithm than the active primary/i),
			).toBeDefined();
		});
	});

	it('WEB-IDP-CRYPTO-11: IdpSettingsPage imports signing options from shared', async () => {
		const mod = await import('@nestidp/shared');
		expect(mod.IDP_SIGNING_SIGNATURE_ALGORITHMS.length).toBe(8);
		expect(mod.getDefaultGenerateIdpSigningCertRequest).toBeTypeOf('function');
	});

	it('WEB-IDP-CRYPTO-12: rsa-sha1 shows deprecation before generate confirm', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		vi.spyOn(adminApi, 'generateIdpSigningCert').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByLabelText(/Signature algorithm/i));
		fireEvent.change(screen.getByLabelText(/Signature algorithm/i), {
			target: { value: 'rsa-sha1' },
		});
		expect(screen.getByText(/SHA-1 signatures are deprecated/i)).toBeDefined();
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		const dialog = await screen.findByRole('dialog');
		expect(dialog.textContent).toMatch(/rsa-sha1/i);
	});

	it('WEB-IDP-CRYPTO-13: start rotation (generate) sends certOptions in body', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const startSpy = vi.spyOn(adminApi, 'startIdpCertRotation').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);

		renderPage();
		await waitFor(() => screen.getByLabelText(/RSA key size/i));
		fireEvent.change(screen.getByLabelText(/RSA key size/i), { target: { value: '4096' } });
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));
		clickDialogConfirm('Start rotation (generate)');

		await waitFor(() =>
			expect(startSpy).toHaveBeenCalledWith(
				expect.objectContaining({ mode: 'generate', rsaModulusBits: 4096 }),
			),
		);
	});

	it('WEB-IDP-CRYPTO-10: after generate, metadata preview refetch runs', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const previewSpy = vi.spyOn(adminApi, 'getIdpMetadataPreview').mockResolvedValue({
			xml: '<EntityDescriptor/>',
			contentType: 'application/xml',
		});
		vi.spyOn(adminApi, 'generateIdpSigningCert').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		await acceptDialogWithChallenge('REPLACE', 'Generate certificate');

		await waitFor(() => expect(previewSpy).toHaveBeenCalled());
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
		await acceptDialogWithChallenge('REPLACE', 'Upload primary certificate');

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

	it('WEB-EVG-CONF-13: copy metadata URL shows toast when clipboard fails', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		Object.assign(navigator, { clipboard: { writeText } });

		renderPage();
		await waitFor(() => screen.getAllByRole('button', { name: 'Copy' }).length > 0);
		fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith('http://localhost:3000/saml/metadata');
			expect(screen.getByText(/Could not copy to clipboard/i)).toBeDefined();
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
		clickDialogConfirm('Start rotation (generate)');

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
				rotation: activeRotation(),
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
			rotation: activeRotation(),
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
		await screen.findByRole('dialog');
		clickDialogConfirm('Start rotation (generate)');

		await waitFor(() => {
			expect(startSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					mode: 'generate',
					keyFamily: 'rsa',
					notAfter: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				}),
			);
			expect(screen.getByRole('heading', { name: 'Certificate rotation' })).toBeDefined();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));
		await acceptDialogWithChallenge('COMPLETE', 'Complete rotation');

		await waitFor(() => {
			expect(completeSpy).toHaveBeenCalledTimes(1);
			expect(screen.getAllByText(/Certificate rotation completed/i).length).toBeGreaterThan(0);
		});
	});

	it('WEB-ADM-CONF-02: generate cancel skips API (was WEB-ADM-54)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi.spyOn(adminApi, 'generateIdpSigningCert');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		await screen.findByRole('dialog');
		clickDialogCancel();

		expect(generateSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-03: upload cancel skips API (was WEB-ADM-55)', async () => {
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
		await screen.findByRole('dialog');
		clickDialogCancel();

		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-04: complete rotation cancel skips API (was WEB-ADM-56)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);
		const completeSpy = vi.spyOn(adminApi, 'completeIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));
		await screen.findByRole('dialog');
		clickDialogCancel();

		expect(completeSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-05: cancel rotation dialog cancel skips API (was WEB-ADM-57)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);
		const cancelSpy = vi.spyOn(adminApi, 'cancelIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Cancel rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));
		await screen.findByRole('dialog');
		clickDialogCancel();

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
				rotation: activeRotation({ startedAt: stale }),
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
				rotation: activeRotation(),
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

	it('WEB-ADM-CONF-06: start rotation cancel skips API (was WEB-ADM-67)', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const startSpy = vi.spyOn(adminApi, 'startIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Start rotation (generate)' }));
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));
		await screen.findByRole('dialog');
		clickDialogCancel();

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
				rotation: activeRotation(),
			}),
		);

		renderPage();

		await waitFor(() => {
			const uploadBtn = screen.getByRole('button', { name: 'Upload certificate' });
			expect((uploadBtn as HTMLButtonElement).disabled).toBe(true);
		});
	});

	it('WEB-ADM-CONF-13: generate cert Confirm disabled until REPLACE typed', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi.spyOn(adminApi, 'generateIdpSigningCert');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		const dialog = await screen.findByRole('dialog');
		const confirmBtn = within(dialog).getByRole('button', { name: 'Generate certificate' });
		expect(confirmBtn).toHaveProperty('disabled', true);
		fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'REPLACE' } });
		fireEvent.click(confirmBtn);
		await waitFor(() => expect(generateSpy).toHaveBeenCalled());
	});

	it('WEB-ADM-CONF-15: generate dialog shows warning tone and audit note', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		const dialog = await screen.findByRole('dialog');
		expect(document.querySelector('.evg-modal--warning')).not.toBeNull();
		expect(within(dialog).getByText(/audit log/i)).toBeDefined();
		expect(within(dialog).getByText(/Replace signing certificate/i)).toBeDefined();
	});

	it('WEB-ADM-CONF-16: generate wrong partial REPLACE keeps confirm disabled', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const generateSpy = vi.spyOn(adminApi, 'generateIdpSigningCert');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Generate certificate' }));
		fireEvent.click(screen.getByRole('button', { name: 'Generate certificate' }));
		const dialog = await screen.findByRole('dialog');
		const confirmBtn = within(dialog).getByRole('button', { name: 'Generate certificate' });
		fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'REPL' } });
		fireEvent.click(confirmBtn);
		expect(generateSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-17: cancel rotation confirm calls API', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);
		const cancelSpy = vi.spyOn(adminApi, 'cancelIdpCertRotation').mockResolvedValue(baseSettings());

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Cancel rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Cancel rotation');

		await waitFor(() => expect(cancelSpy).toHaveBeenCalled());
	});

	it('WEB-ADM-CONF-18: start rotation confirm calls API after dialog', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(baseSettings());
		const startSpy = vi.spyOn(adminApi, 'startIdpCertRotation').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Start rotation (generate)' }));
		fireEvent.click(screen.getByRole('button', { name: 'Start rotation (generate)' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Start rotation (generate)');

		await waitFor(() =>
			expect(startSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					mode: 'generate',
					signatureAlgorithmId: 'rsa-sha256',
					notAfter: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				}),
			),
		);
	});

	it('WEB-ADM-CONF-14: complete rotation Confirm disabled until COMPLETE typed', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
			baseSettings({
				rotation: activeRotation(),
			}),
		);
		const completeSpy = vi.spyOn(adminApi, 'completeIdpCertRotation');

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Complete rotation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Complete rotation' }));
		const dialog = await screen.findByRole('dialog');
		const confirmBtn = within(dialog).getByRole('button', { name: 'Complete rotation' });
		expect(confirmBtn).toHaveProperty('disabled', true);
		fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'COMPLETE' } });
		fireEvent.click(confirmBtn);
		await waitFor(() => expect(completeSpy).toHaveBeenCalled());
	});
});
