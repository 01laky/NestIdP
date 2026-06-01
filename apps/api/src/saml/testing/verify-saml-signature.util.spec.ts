import { randomUUID } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { create } from 'xmlbuilder2';
import { getTestSigningMaterial } from '../../prisma/test-fixtures';
import {
	decodeSamlResponseBase64,
	extractSamlResponseFromHtml,
	verifySamlXmlSignature,
} from './verify-saml-signature.util';

function signTestAssertion(assertionId: string): { signed: string; certPem: string } {
	const xml = create()
		.ele('saml2:Assertion', {
			'xmlns:saml2': 'urn:oasis:names:tc:SAML:2.0:assertion',
			ID: assertionId,
			Version: '2.0',
			IssueInstant: new Date().toISOString(),
		})
		.ele('saml2:Issuer')
		.txt('idp')
		.up()
		.up()
		.end({ headless: true });
	const wrapper = `<container>${xml}</container>`;
	const { privateKeyPem, certPem } = getTestSigningMaterial('urn:test:verify');
	const sig = new SignedXml({
		privateKey: privateKeyPem,
		publicCert: certPem,
		signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
	});
	sig.addReference({
		xpath: `//*[@ID='${assertionId}']`,
		transforms: [
			'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
			'http://www.w3.org/2001/10/xml-exc-c14n#',
		],
		digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
	});
	sig.computeSignature(wrapper, {
		location: { reference: `//*[@ID='${assertionId}']`, action: 'after' },
	});
	const signedWrapper = sig.getSignedXml() ?? wrapper;
	const start = signedWrapper.indexOf('<saml2:Assertion');
	const end = signedWrapper.indexOf('</saml2:Assertion>');
	let fragment = signedWrapper.slice(start, end + '</saml2:Assertion>'.length);
	const after = signedWrapper.slice(end + '</saml2:Assertion>'.length);
	const sigMatch = after.match(/<(?:[\w-]+:)?Signature[\s\S]*?<\/(?:[\w-]+:)?Signature>/);
	if (sigMatch) fragment += sigMatch[0];
	const response = `<?xml version="1.0"?><saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol">${fragment}</saml2p:Response>`;
	return { signed: response, certPem };
}

describe('verifySamlXmlSignature', () => {
	it('API-SAML-VERIFY-01: known-good signed Response verifies', () => {
		const id = `_${randomUUID().replace(/-/g, '')}`;
		const { signed, certPem } = signTestAssertion(id);
		expect(verifySamlXmlSignature(signed, certPem)).toBe(true);
	});

	it('API-SAML-VERIFY-02: tampered XML fails verify', () => {
		const id = '_tamper';
		const { signed, certPem } = signTestAssertion(id);
		const tampered = signed.replace('idp', 'idX');
		expect(verifySamlXmlSignature(tampered, certPem)).toBe(false);
	});

	it('API-SAML-VERIFY-03: wrong cert fails verify', () => {
		const id = '_wrongcert';
		const { signed } = signTestAssertion(id);
		const other = signTestAssertion('_other');
		expect(verifySamlXmlSignature(signed, other.certPem)).toBe(false);
	});

	it('API-SAML-VERIFY-04: unsigned XML fails verify', () => {
		const unsigned =
			'<?xml version="1.0"?><saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="_u"/>';
		const { certPem } = signTestAssertion('_dummy');
		expect(verifySamlXmlSignature(unsigned, certPem)).toBe(false);
	});

	it('API-SAML-VERIFY-05: extractSamlResponseFromHtml decodes base64', () => {
		const html = '<form><input name="SAMLResponse" value="c2VjcmV0"/></form>';
		expect(extractSamlResponseFromHtml(html)).toBe('c2VjcmV0');
		expect(decodeSamlResponseBase64('c2VjcmV0')).toBe('secret');
	});
});
