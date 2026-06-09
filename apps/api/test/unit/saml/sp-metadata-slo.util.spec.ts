import { extractSloUrlFromSpMetadata } from '@api/saml/utils/sp-metadata-slo.util';

function spMetadata(slo: string): string {
	return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:test:sp">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    ${slo}
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

describe('sp-metadata-slo.util', () => {
	it('API-SP-SLOMETA-01: extracts Redirect + POST + SOAP SLO Locations', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp.example/slo/redirect"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://sp.example/slo/post"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp.example/slo/soap"/>',
		);
		const result = extractSloUrlFromSpMetadata(xml);
		expect(result.redirect).toBe('https://sp.example/slo/redirect');
		expect(result.post).toBe('https://sp.example/slo/post');
		expect(result.soap).toBe('https://sp.example/slo/soap');
	});

	it('API-SP-SLOMETA-02: metadata without SLO element returns empty result', () => {
		const xml = spMetadata('');
		const result = extractSloUrlFromSpMetadata(xml);
		expect(result.redirect).toBeNull();
		expect(result.post).toBeNull();
	});

	it('returns empty for malformed/empty XML', () => {
		expect(extractSloUrlFromSpMetadata('')).toEqual({ redirect: null, post: null, soap: null });
		expect(extractSloUrlFromSpMetadata('<not-xml')).toEqual({
			redirect: null,
			post: null,
			soap: null,
		});
	});

	it('EDGE: ignores SingleLogoutService inside IDPSSODescriptor (SP only)', () => {
		const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:test:idp">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp/slo"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null, soap: null });
	});

	it('EDGE: skips SingleLogoutService without a Location attribute', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null, soap: null });
	});

	it('EDGE: only the first Location per binding is kept', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp/slo/a"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp/slo/b"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml).redirect).toBe('https://sp/slo/a');
	});

	it('API-SP-SLOMETA-03: SOAP binding populates the soap field (back-channel autofill, Prompt 36)', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp/slo/soap"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({
			redirect: null,
			post: null,
			soap: 'https://sp/slo/soap',
		});
	});

	it('EDGE: a genuinely unknown binding is ignored', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:example:unknown" Location="https://sp/slo/x"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null, soap: null });
	});

	it('EDGE: SOAP-only metadata yields soap with redirect/post null', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp/slo/soap"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({
			redirect: null,
			post: null,
			soap: 'https://sp/slo/soap',
		});
	});

	it('EDGE: a SOAP SLO inside IDPSSODescriptor is ignored (SP descriptor only)', () => {
		const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:test:idp">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://idp/slo/soap"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
		expect(extractSloUrlFromSpMetadata(xml).soap).toBeNull();
	});

	it('EDGE: only the first SOAP Location is kept when several are present', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp/slo/soap-a"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp/slo/soap-b"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml).soap).toBe('https://sp/slo/soap-a');
	});

	it('EDGE: SOAP without a Location attribute is skipped', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml).soap).toBeNull();
	});
});
