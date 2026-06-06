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
	it('API-SP-SLOMETA-01: extracts Redirect + POST SLO Locations', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp.example/slo/redirect"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://sp.example/slo/post"/>',
		);
		const result = extractSloUrlFromSpMetadata(xml);
		expect(result.redirect).toBe('https://sp.example/slo/redirect');
		expect(result.post).toBe('https://sp.example/slo/post');
	});

	it('API-SP-SLOMETA-02: metadata without SLO element returns empty result', () => {
		const xml = spMetadata('');
		const result = extractSloUrlFromSpMetadata(xml);
		expect(result.redirect).toBeNull();
		expect(result.post).toBeNull();
	});

	it('returns empty for malformed/empty XML', () => {
		expect(extractSloUrlFromSpMetadata('')).toEqual({ redirect: null, post: null });
		expect(extractSloUrlFromSpMetadata('<not-xml')).toEqual({ redirect: null, post: null });
	});

	it('EDGE: ignores SingleLogoutService inside IDPSSODescriptor (SP only)', () => {
		const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:test:idp">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp/slo"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null });
	});

	it('EDGE: skips SingleLogoutService without a Location attribute', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null });
	});

	it('EDGE: only the first Location per binding is kept', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp/slo/a"/>' +
				'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sp/slo/b"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml).redirect).toBe('https://sp/slo/a');
	});

	it('EDGE: unknown binding is ignored', () => {
		const xml = spMetadata(
			'<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="https://sp/slo/soap"/>',
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({ redirect: null, post: null });
	});
});
