import { RELAY_STATE_POST_FIELD, SAML_RESPONSE_POST_FIELD } from '@nestidp/shared';
import { SamlPostBindingService } from '@api/saml/services/saml-post-binding.service';

describe('SamlPostBindingService', () => {
	const service = new SamlPostBindingService();

	it('API-SAML-POST-01: form contains SAMLResponse hidden input', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'base64-response');
		expect(html).toContain(`name="${SAML_RESPONSE_POST_FIELD}"`);
		expect(html).toContain('value="base64-response"');
	});

	it('API-SAML-POST-02: form action is ACS URL', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'b64');
		expect(html).toContain('action="https://sp.example.com/acs"');
		expect(html).toContain('method="post"');
	});

	it('API-SAML-POST-03: RelayState field when provided', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'b64', 'relay-abc');
		expect(html).toContain(`name="${RELAY_STATE_POST_FIELD}"`);
		expect(html).toContain('value="relay-abc"');
	});

	it('API-SAML-POST-04: escapes dangerous characters in ACS URL', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs?x="<>', 'b64');
		expect(html).not.toContain('action="https://sp.example.com/acs?x="<>"');
		expect(html).toContain('&quot;');
	});

	it('API-SAML-POST-05: escapes RelayState value', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'b64', 'state"><script');
		expect(html).toContain('&quot;');
		expect(html).not.toContain('"><script');
	});

	it('API-SAML-POST-06: omits RelayState input when absent', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'b64');
		expect(html).not.toContain(RELAY_STATE_POST_FIELD);
	});

	it('API-SAML-POST-07: auto-submit via body onload', () => {
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'b64');
		expect(html).toContain('onload="document.forms[0].submit()"');
	});

	it('API-SAML-POST-08: does not embed raw assertion XML in visible text', () => {
		const rawXml = '<saml2:Assertion ID="_abc">';
		const html = service.renderAutoPostForm('https://sp.example.com/acs', 'only-base64-here');
		expect(html).not.toContain(rawXml);
		expect(html).not.toContain('<saml2:Assertion');
	});
});
