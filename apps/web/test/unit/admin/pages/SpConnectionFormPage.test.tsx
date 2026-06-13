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

	// --- Back-channel SOAP SLO field (Prompt 36, WEB-BC-02) ----------------------------------------

	function spFixture(overrides: Record<string, unknown> = {}) {
		return {
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
			sloSoapUrl: 'https://sp.example.com/slo/soap',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			...overrides,
		};
	}

	function renderEdit() {
		return renderWithUi(
			<MemoryRouter initialEntries={['/admin/sp-connections/sp-1']}>
				<Routes>
					<Route path="/admin/sp-connections/:id" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
	}

	it('WEB-BC-02: SOAP SLO field renders and warns when set without a cert and over http', async () => {
		const { container } = renderNew();
		const soap = container.querySelector('input[name="sloSoapUrl"]') as HTMLInputElement;
		expect(soap).not.toBeNull();
		fireEvent.change(soap, { target: { value: 'http://sp.example.com/slo/soap' } });
		await waitFor(() => {
			expect(screen.getByText(/certificate is required to use a SOAP SLO/i)).toBeDefined();
			expect(screen.getByText(/not HTTPS/i)).toBeDefined();
		});
	});

	it('WEB-BC-02b: the "Test back-channel SLO" button calls the probe endpoint and shows the result', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue(spFixture() as never);
		const probe = vi.spyOn(adminApi, 'testSpConnectionBackchannel').mockResolvedValue({ ok: true });
		renderEdit();
		const button = await waitFor(() =>
			screen.getByRole('button', { name: 'Test back-channel SLO' }),
		);
		fireEvent.click(button);
		await waitFor(() => {
			expect(probe).toHaveBeenCalledWith('sp-1');
			expect(screen.getByText(/Reachable/i)).toBeDefined();
		});
	});

	it('WEB-BC-02c: a failed probe surfaces the redacted reason', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue(spFixture() as never);
		vi.spyOn(adminApi, 'testSpConnectionBackchannel').mockResolvedValue({
			ok: false,
			reason: 'timeout',
		});
		renderEdit();
		const button = await waitFor(() =>
			screen.getByRole('button', { name: 'Test back-channel SLO' }),
		);
		fireEvent.click(button);
		await waitFor(() => {
			expect(screen.getByText(/timeout/i)).toBeDefined();
		});
	});

	it('WEB-BC-02d: the test button is hidden when no SOAP endpoint is configured', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue(
			spFixture({ sloSoapUrl: null }) as never,
		);
		renderEdit();
		await waitFor(() => expect(screen.getByText('Probe SP signing key')).toBeDefined());
		expect(screen.queryByRole('button', { name: 'Test back-channel SLO' })).toBeNull();
	});

	// --- Import from SP metadata (Prompt 42, WEB-SPM) ----------------------------------------------

	function importResult(overrides: Partial<adminApi.SpConnectionPublicDto> = {}) {
		const base = {
			valid: true,
			entityId: 'https://sp.example.com/sp',
			acsUrl: 'https://sp.example.com/acs',
			acsOptions: [
				{
					binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
					location: 'https://sp.example.com/acs',
					index: 0,
					isDefault: true,
				},
			],
			sloUrl: 'https://sp.example.com/slo',
			sloSoapUrl: 'https://sp.example.com/slo/soap',
			nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
			spCertificate: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
			signingCertificates: ['-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'],
			authnRequestsSigned: false,
			wantAssertionsSigned: false,
			signed: false,
			warnings: [],
			entityIdConflict: null,
		};
		return { ...base, ...overrides } as unknown as Awaited<
			ReturnType<typeof adminApi.parseSpMetadata>
		>;
	}

	it('WEB-SPM-01: pasting metadata prefills entityID, ACS, SLO, SOAP and cert (review before save)', async () => {
		const parseSpy = vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(importResult());
		const createSpy = vi.spyOn(adminApi, 'createSpConnection');
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md:EntityDescriptor/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() => {
			expect(parseSpy).toHaveBeenCalledWith('<md:EntityDescriptor/>');
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'https://sp.example.com/sp',
			);
			expect((container.querySelector('input[name="acsUrl"]') as HTMLInputElement).value).toBe(
				'https://sp.example.com/acs',
			);
			expect((container.querySelector('input[name="sloSoapUrl"]') as HTMLInputElement).value).toBe(
				'https://sp.example.com/slo/soap',
			);
		});
		// Nothing was auto-submitted.
		expect(createSpy).not.toHaveBeenCalled();
	});

	it('WEB-SPM-01b: warnings and an entityID conflict are surfaced', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({
				warnings: [
					{ code: 'no_signing_certificate' },
					{ code: 'metadata_expired', detail: '2020-01-01' },
				],
				entityIdConflict: { id: 'sp-existing', name: 'Existing SP' },
			} as never),
		);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() => {
			expect(screen.getByText(/no signing certificate/i)).toBeDefined();
			expect(screen.getByText(/expired on 2020-01-01/i)).toBeDefined();
			expect(screen.getByText(/Existing SP/)).toBeDefined();
		});
	});

	it('WEB-SPM-02: an ACS picker appears for multiple endpoints and switching changes acsUrl', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({
				acsUrl: 'https://sp.example.com/acs-a',
				acsOptions: [
					{
						binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
						location: 'https://sp.example.com/acs-a',
						index: 0,
						isDefault: true,
					},
					{
						binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
						location: 'https://sp.example.com/acs-b',
						index: 1,
						isDefault: false,
					},
				],
			} as never),
		);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		const picker = await screen.findByRole('combobox', { name: /Assertion Consumer Service/i });
		fireEvent.change(picker, { target: { value: 'https://sp.example.com/acs-b' } });
		expect((container.querySelector('input[name="acsUrl"]') as HTMLInputElement).value).toBe(
			'https://sp.example.com/acs-b',
		);
	});

	it('WEB-SPM-03: fetch-by-URL mode calls fetchSpMetadataFromUrl and prefills', async () => {
		const fetchSpy = vi.spyOn(adminApi, 'fetchSpMetadataFromUrl').mockResolvedValue(importResult());
		const { container } = renderNew();
		fireEvent.click(screen.getByRole('button', { name: 'Fetch from URL' }));
		fireEvent.change(container.querySelector('input[name="importUrl"]')!, {
			target: { value: 'https://sp.example.com/metadata' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Fetch & prefill' }));
		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledWith('https://sp.example.com/metadata');
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'https://sp.example.com/sp',
			);
		});
	});

	it('WEB-SPM-03b: invalid (not SP) metadata shows a message and prefills nothing', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({ valid: false, entityId: null, acsUrl: null } as never),
		);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<not-sp/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() => {
			expect(screen.getByText(/No SP descriptor found/i)).toBeDefined();
		});
		expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
			'',
		);
	});

	it('WEB-SPM-04: on the edit form, import is a confirmed refresh before overwriting fields', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue(
			spFixture({ spEntityId: 'urn:sp:old' }) as never,
		);
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({ entityId: 'urn:sp:refreshed' } as never),
		);
		const { container } = renderEdit();
		await waitFor(() =>
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'urn:sp:old',
			),
		);
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		// A confirm dialog appears; the field is unchanged until confirmed.
		const applyBtn = await screen.findByRole('button', { name: 'Apply' });
		expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
			'urn:sp:old',
		);
		fireEvent.click(applyBtn);
		await waitFor(() =>
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'urn:sp:refreshed',
			),
		);
	});

	it('WEB-SPM-04b: cancelling the edit-refresh confirm leaves fields unchanged', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue(
			spFixture({ spEntityId: 'urn:sp:keepme' }) as never,
		);
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({ entityId: 'urn:sp:discarded' } as never),
		);
		const { container } = renderEdit();
		await waitFor(() =>
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'urn:sp:keepme',
			),
		);
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		const cancelBtn = await screen.findByRole('button', { name: 'Cancel' });
		fireEvent.click(cancelBtn);
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull());
		expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
			'urn:sp:keepme',
		);
	});

	it('WEB-SPM-05: an import failure surfaces an error message and prefills nothing', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockRejectedValue(
			new adminApi.AdminApiError(400, 'Could not fetch SP metadata: too_large'),
		);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() => {
			expect(screen.getByText(/too_large/i)).toBeDefined();
		});
		expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
			'',
		);
	});

	it('WEB-SPM-06: after importing, save sends the importSource for audit', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(importResult());
		const createSpy = vi.spyOn(adminApi, 'createSpConnection').mockResolvedValue({
			item: { id: 'sp-imported' },
		} as never);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() =>
			expect((container.querySelector('input[name="spEntityId"]') as HTMLInputElement).value).toBe(
				'https://sp.example.com/sp',
			),
		);
		// Name is not carried by metadata — set it, then save.
		fireEvent.change(container.querySelector('input[name="name"]')!, {
			target: { value: 'Imported App' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => {
			expect(createSpy).toHaveBeenCalledWith(
				expect.objectContaining({ importSource: 'metadata_xml' }),
			);
		});
	});

	it('WEB-SPM-07: toggling to "Fetch from URL" swaps the textarea for a URL input', async () => {
		const { container } = renderNew();
		expect(container.querySelector('textarea[name="importXml"]')).not.toBeNull();
		expect(container.querySelector('input[name="importUrl"]')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Fetch from URL' }));
		expect(container.querySelector('input[name="importUrl"]')).not.toBeNull();
		expect(container.querySelector('textarea[name="importXml"]')).toBeNull();
	});

	it('WEB-SPM-08: a signing cert + AuthnRequestsSigned suggestion ticks the checkbox', async () => {
		vi.spyOn(adminApi, 'parseSpMetadata').mockResolvedValue(
			importResult({ authnRequestsSigned: true } as never),
		);
		const { container } = renderNew();
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Parse & prefill' }));
		await waitFor(() => {
			const cb = screen.getByRole('checkbox', { name: /Require signed AuthnRequest/i });
			expect(cb).toHaveProperty('checked', true);
			expect(cb).toHaveProperty('disabled', false); // cert present → enabled
		});
	});

	it('WEB-SPM-09: import buttons are disabled until their input has content', () => {
		const { container } = renderNew();
		expect(screen.getByRole('button', { name: 'Parse & prefill' })).toHaveProperty(
			'disabled',
			true,
		);
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: ' ' },
		});
		// whitespace-only stays disabled
		expect(screen.getByRole('button', { name: 'Parse & prefill' })).toHaveProperty(
			'disabled',
			true,
		);
		fireEvent.change(container.querySelector('textarea[name="importXml"]')!, {
			target: { value: '<md/>' },
		});
		expect(screen.getByRole('button', { name: 'Parse & prefill' })).toHaveProperty(
			'disabled',
			false,
		);
	});
});
