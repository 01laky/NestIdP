import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { GenerateIdpSigningCertRequestDto } from '@nestidp/shared';
import {
	buildIdpSigningGenerateOptionsForUi,
	getDefaultGenerateIdpSigningCertRequest,
} from '@nestidp/shared';
import { getI18n } from '../../i18n/i18n';
import {
	buildCertOptionsConfirmSummary,
	IdpSigningCertOptionsFields,
} from './IdpSigningCertOptionsFields';

afterEach(() => {
	cleanup();
});

function renderFields(
	value = getDefaultGenerateIdpSigningCertRequest(),
	onChange: (next: GenerateIdpSigningCertRequestDto) => void = () => undefined,
) {
	return render(
		<I18nextProvider i18n={getI18n()}>
			<IdpSigningCertOptionsFields value={value} onChange={onChange} />
		</I18nextProvider>,
	);
}

describe('IdpSigningCertOptionsFields', () => {
	it('WEB-IDP-CRYPTO-01: changing key family filters signature options', () => {
		renderFields({
			...getDefaultGenerateIdpSigningCertRequest(),
			keyFamily: 'ec',
			signatureAlgorithmId: 'ecdsa-sha256',
		});
		expect(screen.getByLabelText(/Signature algorithm/i)).toBeDefined();
		expect(screen.getByText(/ECDSA-SHA256/)).toBeDefined();
	});

	it('WEB-IDP-CRYPTO-02: date input has min and max', () => {
		const { container } = renderFields();
		const input = container.querySelector('input[type="date"]') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.required).toBe(true);
		expect(input.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('WEB-IDP-CRYPTO-06: reset to defaults restores RSA-2048', () => {
		let state: GenerateIdpSigningCertRequestDto = {
			...getDefaultGenerateIdpSigningCertRequest(),
			keyFamily: 'ec',
		};
		renderFields(state, (next) => {
			state = next;
		});
		fireEvent.click(screen.getAllByRole('button', { name: /Reset to defaults/i })[0]!);
		expect(state.keyFamily).toBe('rsa');
		expect(state.rsaModulusBits).toBe(2048);
	});

	it('WEB-IDP-CRYPTO-05: confirm summary includes options', () => {
		const summary = buildCertOptionsConfirmSummary(
			getDefaultGenerateIdpSigningCertRequest(),
			(key, opts) => `${key}:${JSON.stringify(opts)}`,
		);
		expect(summary).toContain('rsa');
		expect(summary).toContain('rsa-sha256');
	});

	it('WEB-IDP-CRYPTO-04: SHA-1 selection shows deprecation callout', () => {
		renderFields({
			...getDefaultGenerateIdpSigningCertRequest(),
			signatureAlgorithmId: 'rsa-sha1',
		});
		expect(screen.getByText(/SHA-1 signatures are deprecated/i)).toBeDefined();
	});

	it('WEB-IDP-CRYPTO-07: EC key family shows SP compatibility callout', () => {
		renderFields({
			...getDefaultGenerateIdpSigningCertRequest(),
			keyFamily: 'ec',
			signatureAlgorithmId: 'ecdsa-sha256',
		});
		expect(screen.getAllByText(/not supported by all service providers/i).length).toBeGreaterThan(
			0,
		);
	});

	it('WEB-IDP-CRYPTO-15: signing catalog comes from shared package', () => {
		expect(buildIdpSigningGenerateOptionsForUi().algorithms).toHaveLength(8);
	});

	it('WEB-IDP-CRYPTO-16: RSA modulus 3072 selection updates state', () => {
		let state: GenerateIdpSigningCertRequestDto = getDefaultGenerateIdpSigningCertRequest();
		renderFields(state, (next) => {
			state = next;
		});
		fireEvent.change(screen.getByLabelText(/RSA key size/i), { target: { value: '3072' } });
		expect(state.rsaModulusBits).toBe(3072);
	});

	it('WEB-IDP-CRYPTO-17: only RSA algorithms listed when key family is rsa', () => {
		renderFields(getDefaultGenerateIdpSigningCertRequest());
		expect(screen.queryByText(/ECDSA-SHA256/)).toBeNull();
		expect(screen.getByText(/RSA-SHA256/)).toBeDefined();
	});

	it('WEB-IDP-CRYPTO-18: date max is within ten years of today', () => {
		const { container } = renderFields();
		const input = container.querySelector('input[type="date"]') as HTMLInputElement;
		const maxYear = Number(input.max.slice(0, 4));
		const thisYear = new Date().getFullYear();
		expect(maxYear - thisYear).toBeLessThanOrEqual(10);
		expect(maxYear - thisYear).toBeGreaterThanOrEqual(9);
	});
});
