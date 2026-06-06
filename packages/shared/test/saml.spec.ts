import { describe, expect, it } from 'vitest';
import {
	RELAY_STATE_POST_FIELD,
	RELAY_STATE_QUERY_PARAM,
	SIGNATURE_QUERY_PARAM,
	SIG_ALG_QUERY_PARAM,
	SAML_METADATA_PATH,
	SAML_NAME_ID_FORMATS,
	SAML_REDIRECT_SIGNATURE_ALGORITHMS,
	SAML_REQUEST_QUERY_PARAM,
	SAML_RESPONSE_POST_FIELD,
	SAML_SSO_PATH,
	SP_CONNECTIONS_API_PATH,
	type CreateSpConnectionRequestDto,
	type ProbeSpSigningRequestDto,
	type ProbeSpSigningResponseDto,
	type SpConnectionTestSsoUrlResponseDto,
	type SpAttributeMappingConfig,
} from '@shared/saml.js';

describe('saml shared', () => {
	it('SH-SAML-01: SAML path constants', () => {
		expect(SAML_METADATA_PATH).toBe('/saml/metadata');
		expect(SAML_SSO_PATH).toBe('/saml/sso');
		expect(SP_CONNECTIONS_API_PATH).toBe('/api/admin/sp-connections');
	});

	it('SH-SAML-02: binding query and POST field names', () => {
		expect(SAML_REQUEST_QUERY_PARAM).toBe('SAMLRequest');
		expect(RELAY_STATE_QUERY_PARAM).toBe('RelayState');
		expect(SIG_ALG_QUERY_PARAM).toBe('SigAlg');
		expect(SIGNATURE_QUERY_PARAM).toBe('Signature');
		expect(SAML_RESPONSE_POST_FIELD).toBe('SAMLResponse');
		expect(RELAY_STATE_POST_FIELD).toBe('RelayState');
	});

	it('SH-SAML-03: SpAttributeMappingConfig shape', () => {
		const sample: SpAttributeMappingConfig = {
			nameId: { source: 'email' },
			attributes: [{ samlName: 'memberOf', source: 'groups' }],
		};
		expect(sample.attributes?.[0]?.samlName).toBe('memberOf');
	});

	it('SH-SAML-04: SAML_NAME_ID_FORMATS is non-empty readonly list', () => {
		expect(SAML_NAME_ID_FORMATS.length).toBeGreaterThan(0);
		expect(SAML_NAME_ID_FORMATS[0]).toMatch(/^urn:/);
	});

	it('SH-SAML-05: CreateSpConnectionRequestDto minimal body', () => {
		const body: CreateSpConnectionRequestDto = {
			name: 'App',
			spEntityId: 'urn:sp:app',
			acsUrl: 'https://sp.example.com/acs',
		};
		expect(body.active).toBeUndefined();
		expect(body.attributeMapping).toBeUndefined();
		expect(body.wantAuthnRequestsSigned).toBeUndefined();
	});

	it('SH-SAML-06: redirect signature algorithm registry includes rsa-sha256', () => {
		expect(SAML_REDIRECT_SIGNATURE_ALGORITHMS.some((option) => option.id === 'rsa-sha256')).toBe(
			true,
		);
	});

	it('SH-SAML-07: signing probe DTOs and test SSO URL DTO are assignable', () => {
		const testSso: SpConnectionTestSsoUrlResponseDto = {
			url: 'https://idp.example.com/saml/sso?SAMLRequest=abc',
		};
		const request: ProbeSpSigningRequestDto = {
			requestUrl: testSso.url,
		};
		const response: ProbeSpSigningResponseDto = {
			isSigned: true,
			signatureAlgorithm: SAML_REDIRECT_SIGNATURE_ALGORITHMS[0] ?? null,
		};
		expect(request.requestUrl).toContain('SAMLRequest');
		expect(response.isSigned).toBe(true);
	});
});
