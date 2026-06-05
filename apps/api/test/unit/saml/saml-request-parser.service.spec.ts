import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deflateSync } from 'node:zlib';
import { buildAuthnRequestXml, encodeRedirectBinding } from '@test/support/saml/build-authn-request.util';
import { SamlRequestParserService } from '@api/saml/services/saml-request-parser.service';

describe('SamlRequestParserService', () => {
	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'IDP_BASE_URL') return 'http://localhost:3000';
			if (key === 'SAML_CLOCK_SKEW_SECONDS') return 120;
			return undefined;
		}),
	} as unknown as ConfigService;

	const parser = new SamlRequestParserService(configService);

	function validEncodedRequest(options?: {
		id?: string;
		issuer?: string;
		destination?: string;
		issueInstant?: string;
		xml?: string;
	}): string {
		const xml =
			options?.xml ??
			buildAuthnRequestXml({
				id: options?.id ?? '_test-id-1',
				issuer: options?.issuer ?? 'urn:test:sp',
				destination: options?.destination ?? 'http://localhost:3000/saml/sso',
				issueInstant: options?.issueInstant,
			});
		return encodeURIComponent(encodeRedirectBinding(xml));
	}

	it('API-SAML-PARSE-01: valid minimal AuthnRequest round-trip', () => {
		const result = parser.parseRedirectBinding(validEncodedRequest(), 'relay-1');
		expect(result.authnRequest.id).toBe('_test-id-1');
		expect(result.authnRequest.issuer).toBe('urn:test:sp');
		expect(result.relayState).toBe('relay-1');
	});

	it('API-SAML-PARSE-02: invalid base64 → 400', () => {
		expect(() => parser.parseRedirectBinding('%%%not-valid-base64%%%')).toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-03: invalid deflate payload → 400', () => {
		const garbage = encodeURIComponent(Buffer.from('not-deflate').toString('base64'));
		expect(() => parser.parseRedirectBinding(garbage)).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-04: missing ID → 400', () => {
		const xml = buildAuthnRequestXml({
			id: '',
			issuer: 'urn:test',
			destination: 'http://localhost:3000/saml/sso',
		});
		expect(() =>
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-05: missing Issuer → 400', () => {
		const xml = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_no-issuer" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="http://localhost:3000/saml/sso"/>`;
		expect(() => parser.parseRedirectBinding(validEncodedRequest({ xml }))).toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-06: IssueInstant too far in future → 400', () => {
		const future = new Date(Date.now() + 10 * 60_000).toISOString();
		expect(() =>
			parser.parseRedirectBinding(validEncodedRequest({ issueInstant: future })),
		).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-07: IssueInstant too far in past → 400', () => {
		const past = new Date(Date.now() - 10 * 60_000).toISOString();
		expect(() => parser.parseRedirectBinding(validEncodedRequest({ issueInstant: past }))).toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-08: empty SAMLRequest → 400', () => {
		expect(() => parser.parseRedirectBinding('')).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-09: oversized payload (> 256 KB) → 400', () => {
		const padding = 'x'.repeat(260 * 1024);
		const xml = buildAuthnRequestXml({
			id: '_big',
			issuer: `urn:test:${padding}`,
			destination: 'http://localhost:3000/saml/sso',
		});
		expect(() =>
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-10: wrong root element → 400', () => {
		const xml = `<?xml version="1.0"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_x"/>`;
		expect(() => parser.parseRedirectBinding(validEncodedRequest({ xml }))).toThrow(
			BadRequestException,
		);
	});

	it('API-SAML-PARSE-11: RelayState preserved in result', () => {
		const result = parser.parseRedirectBinding(validEncodedRequest(), 'opaque-state-99');
		expect(result.relayState).toBe('opaque-state-99');
	});

	it('API-SAML-PARSE-12: Unicode Issuer preserved', () => {
		const issuer = 'urn:sp:café-naïve-日本';
		const result = parser.parseRedirectBinding(validEncodedRequest({ issuer }));
		expect(result.authnRequest.issuer).toBe(issuer);
	});

	it('API-SAML-PARSE-13: Destination matches IdP SSO URL', () => {
		const result = parser.parseRedirectBinding(
			validEncodedRequest({ destination: 'http://localhost:3000/saml/sso/' }),
		);
		expect(result.authnRequest.destination).toBe('http://localhost:3000/saml/sso/');
	});

	it('API-SAML-PARSE-14: Destination mismatch → 400', () => {
		expect(() =>
			parser.parseRedirectBinding(
				validEncodedRequest({ destination: 'http://evil.example.com/saml/sso' }),
			),
		).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-15: malformed XML → 400', () => {
		const xml = '<samlp:AuthnRequest><unclosed';
		expect(() =>
			parser.parseRedirectBinding(encodeURIComponent(encodeRedirectBinding(xml))),
		).toThrow(BadRequestException);
	});

	it('API-SAML-PARSE-16: zlib-wrapped deflate still parses', () => {
		const xml = buildAuthnRequestXml({
			id: '_zlib-id',
			issuer: 'urn:test:zlib',
			destination: 'http://localhost:3000/saml/sso',
		});
		const zlibWrapped = deflateSync(Buffer.from(xml, 'utf8'));
		const encoded = encodeURIComponent(zlibWrapped.toString('base64'));
		const result = parser.parseRedirectBinding(encoded);
		expect(result.authnRequest.id).toBe('_zlib-id');
	});

	it('API-SAML-PARSE-17: omits Destination validation when attribute absent', () => {
		const xml = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_no-dest" Version="2.0" IssueInstant="${new Date().toISOString()}">
  <saml:Issuer>urn:test:no-dest</saml:Issuer>
</samlp:AuthnRequest>`;
		const result = parser.parseRedirectBinding(validEncodedRequest({ xml }));
		expect(result.authnRequest.destination).toBeUndefined();
	});
});
