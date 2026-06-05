import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { GenerateIdpEncryptionCertRequestDto } from '@nestidp/shared';
import {
	buildIdpEncryptionGenerateOptionsForUi,
	getDefaultGenerateIdpEncryptionCertRequest,
} from '@nestidp/shared';
import { getI18n } from '@/i18n/i18n';
import {
	buildEncryptionCertOptionsConfirmSummary,
	IdpEncryptionCertOptionsFields,
} from '@/admin/components/idp-cert/IdpEncryptionCertOptionsFields';

afterEach(() => {
	cleanup();
});

function renderFields(
	value = getDefaultGenerateIdpEncryptionCertRequest(),
	onChange: (next: GenerateIdpEncryptionCertRequestDto) => void = () => undefined,
) {
	return render(
		<I18nextProvider i18n={getI18n()}>
			<IdpEncryptionCertOptionsFields value={value} onChange={onChange} />
		</I18nextProvider>,
	);
}

describe('IdpEncryptionCertOptionsFields', () => {
	it('WEB-IDP-ENC-01: changing key family filters key transport options', () => {
		renderFields({
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyFamily: 'ec',
			ecCurve: 'P-256',
		});
		expect(screen.queryByLabelText(/Key transport algorithm/i)).toBeNull();
		renderFields(getDefaultGenerateIdpEncryptionCertRequest());
		expect(screen.getByLabelText(/Key transport algorithm/i)).toBeDefined();
		expect(screen.getByText(/RSA-OAEP-MGF1P/)).toBeDefined();
	});

	it('WEB-IDP-ENC-02: date input has min and max', () => {
		const { container } = renderFields();
		const input = container.querySelector('input[type="date"]') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.required).toBe(true);
		expect(input.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('WEB-IDP-ENC-03: RSA-1_5 selection shows deprecation callout', () => {
		renderFields({
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyTransportAlgorithmId: 'rsa-1_5',
		});
		expect(screen.getByText(/RSA-1_5 key transport is deprecated/i)).toBeDefined();
	});

	it('WEB-IDP-ENC-04: confirm summary includes options', () => {
		const summary = buildEncryptionCertOptionsConfirmSummary(
			getDefaultGenerateIdpEncryptionCertRequest(),
			(key, opts) => `${key}:${JSON.stringify(opts)}`,
		);
		expect(summary).toContain('rsa');
		expect(summary).toContain('rsa-oaep-mgf1p');
	});

	it('WEB-IDP-ENC-05: reset to defaults restores RSA-2048', () => {
		let state: GenerateIdpEncryptionCertRequestDto = {
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyFamily: 'ec',
		};
		renderFields(state, (next) => {
			state = next;
		});
		fireEvent.click(screen.getAllByRole('button', { name: /Reset to defaults/i })[0]!);
		expect(state.keyFamily).toBe('rsa');
		expect(state.rsaModulusBits).toBe(2048);
	});

	it('WEB-IDP-ENC-06: EC key family shows SP compatibility callout', () => {
		renderFields({
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyFamily: 'ec',
			ecCurve: 'P-256',
		});
		expect(screen.getAllByText(/not supported by all service providers/i).length).toBeGreaterThan(
			0,
		);
	});

	it('WEB-IDP-ENC-07: encryption catalog comes from shared package', () => {
		expect(buildIdpEncryptionGenerateOptionsForUi().algorithms).toHaveLength(3);
	});

	it('WEB-IDP-ENC-08: RSA modulus 3072 selection updates state', () => {
		let state: GenerateIdpEncryptionCertRequestDto = getDefaultGenerateIdpEncryptionCertRequest();
		renderFields(state, (next) => {
			state = next;
		});
		fireEvent.change(screen.getByLabelText(/RSA key size/i), { target: { value: '3072' } });
		expect(state.rsaModulusBits).toBe(3072);
	});

	it('WEB-IDP-ENC-09: only RSA transport algorithms when key family is rsa', () => {
		renderFields(getDefaultGenerateIdpEncryptionCertRequest());
		const transport = screen.getByLabelText(/Key transport algorithm/i);
		const options = Array.from(transport.querySelectorAll('option')).map((o) => o.textContent);
		expect(options.some((t) => t?.includes('RSA-OAEP-MGF1P'))).toBe(true);
		expect(options.some((t) => t?.includes('RSA-1_5'))).toBe(true);
		expect(options).toHaveLength(3);
	});

	it('WEB-IDP-ENC-10: date max is within ten years of today', () => {
		const { container } = renderFields();
		const input = container.querySelector('input[type="date"]') as HTMLInputElement;
		const maxYear = Number(input.max.slice(0, 4));
		const thisYear = new Date().getFullYear();
		expect(maxYear - thisYear).toBeLessThanOrEqual(10);
		expect(maxYear - thisYear).toBeGreaterThanOrEqual(9);
	});

	it('WEB-IDP-ENC-11: EC key family hides key transport select', () => {
		renderFields({
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyFamily: 'ec',
		});
		expect(screen.queryByLabelText(/Key transport algorithm/i)).toBeNull();
	});

	it('WEB-IDP-ENC-12: default transport is rsa-oaep-mgf1p after reset', () => {
		let state: GenerateIdpEncryptionCertRequestDto = {
			...getDefaultGenerateIdpEncryptionCertRequest(),
			keyTransportAlgorithmId: 'rsa-1_5',
		};
		renderFields(state, (next) => {
			state = next;
		});
		fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/i }));
		expect(state.keyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
	});

	it('WEB-IDP-ENC-13: content encryption note callout visible', () => {
		renderFields();
		expect(screen.getByText(/AES-256-CBC/i)).toBeDefined();
	});

	it('WEB-IDP-ENC-14: confirm summary uses EC no-transport label for EC keys', () => {
		const summary = buildEncryptionCertOptionsConfirmSummary(
			{ keyFamily: 'ec', ecCurve: 'P-384', notAfter: '2028-01-01' },
			(key, opts) => `${key}:${opts?.algorithm ?? ''}`,
		);
		expect(summary).toContain('encryption.crypto.ecNoKeyTransport');
	});
});
