import { SamlLogoutResponseBuilderService } from '@api/saml/services/saml-logout-response-builder.service';
import { IdpSigningService, type SigningMaterial } from '@api/saml/services/idp-signing.service';
import { verifyEnvelopedXmlDsig } from '@api/saml/utils/saml-enveloped-signature.util';
import {
	buildSignedRedirectBindingResponse,
	verifyRedirectBindingSignature,
} from '@api/saml/utils/saml-authn-request-redirect-signature.util';
import { SAML_STATUS_REQUEST_DENIED, SAML_STATUS_SUCCESS } from '@nestidp/shared';
import {
	generateTestEcSigningKeyPair,
	generateTestSpSigningKeyPair,
} from '@test/support/saml/build-logout-request.util';

describe('saml-logout-response-builder.service', () => {
	const builder = new SamlLogoutResponseBuilderService();
	const idpSigning = new IdpSigningService({} as never, {} as never, {} as never, {} as never);
	let material: SigningMaterial;

	beforeAll(() => {
		const { certPem, privateKeyPem } = generateTestSpSigningKeyPair('idp');
		material = { certPem, privateKeyPem, signatureAlgorithmId: 'rsa-sha256' };
	});

	it('API-SLO-RESP-01: builds LogoutResponse with InResponseTo + Destination=sloUrl + Success', () => {
		const { xml, responseId } = builder.build({
			inResponseTo: '_req123',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		expect(xml).toContain('samlp:LogoutResponse');
		expect(xml).toContain('InResponseTo="_req123"');
		expect(xml).toContain('Destination="https://sp.example/slo"');
		expect(xml).toContain(SAML_STATUS_SUCCESS);
		expect(responseId).toMatch(/^_/);
	});

	it('API-SLO-RESP-02: signed LogoutResponse verifies with the IdP certificate (POST)', () => {
		const { xml, responseId } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		const signed = idpSigning.signLogoutResponse(xml, material, responseId);
		expect(signed).toContain('Signature');
		expect(verifyEnvelopedXmlDsig(signed, material.certPem)).toBe(true);
	});

	it('API-SLO-RESP-03: RequestDenied status on validation-failure path', () => {
		const { xml } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'request_denied',
		});
		expect(xml).toContain(SAML_STATUS_REQUEST_DENIED);
	});

	it('builds a signed Redirect-binding query keyed to SAMLResponse', () => {
		const { xml } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		const query = buildSignedRedirectBindingResponse({
			responseXml: xml,
			relayState: 'rs1',
			sigAlgUri: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
			privateKeyPem: material.privateKeyPem,
		});
		expect(query).toContain('SAMLResponse=');
		expect(query).toContain('RelayState=rs1');
		expect(query).toContain('SigAlg=');
		expect(query).toContain('Signature=');
		expect(query).not.toContain('SAMLRequest=');
	});

	it('EDGE: RSA Redirect signature round-trips (sign → verify)', () => {
		const { xml } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		const sigAlg = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
		const query = buildSignedRedirectBindingResponse({
			responseXml: xml,
			sigAlgUri: sigAlg,
			privateKeyPem: material.privateKeyPem,
		});
		const params = new URLSearchParams(query);
		const signedContent = `SAMLResponse=${encodeURIComponent(params.get('SAMLResponse')!)}&SigAlg=${encodeURIComponent(params.get('SigAlg')!)}`;
		expect(
			verifyRedirectBindingSignature({
				signedContent,
				signatureBase64UrlEncoded: encodeURIComponent(params.get('Signature')!),
				sigAlgUri: sigAlg,
				certificatePem: material.certPem,
			}),
		).toBe(true);
	});

	it('EDGE: EC Redirect signature round-trips with ecdsa-sha256', () => {
		const ec = generateTestEcSigningKeyPair('ec-idp');
		const { xml } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		const sigAlg = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
		const query = buildSignedRedirectBindingResponse({
			responseXml: xml,
			sigAlgUri: sigAlg,
			privateKeyPem: ec.privateKeyPem,
		});
		const params = new URLSearchParams(query);
		const signedContent = `SAMLResponse=${encodeURIComponent(params.get('SAMLResponse')!)}&SigAlg=${encodeURIComponent(params.get('SigAlg')!)}`;
		expect(
			verifyRedirectBindingSignature({
				signedContent,
				signatureBase64UrlEncoded: encodeURIComponent(params.get('Signature')!),
				sigAlgUri: sigAlg,
				certificatePem: ec.certPem,
			}),
		).toBe(true);
	});

	it('EDGE: unsupported sigAlg throws', () => {
		const { xml } = builder.build({
			inResponseTo: '_req',
			destination: 'https://sp.example/slo',
			idpEntityId: 'https://idp.example',
			status: 'success',
		});
		expect(() =>
			buildSignedRedirectBindingResponse({
				responseXml: xml,
				sigAlgUri: 'http://example.com/nope',
				privateKeyPem: material.privateKeyPem,
			}),
		).toThrow();
	});

	it('EDGE: XML-escapes special chars in Destination / Issuer / InResponseTo', () => {
		const { xml } = builder.build({
			inResponseTo: '_req<&">',
			destination: 'https://sp.example/slo?a=1&b=2',
			idpEntityId: 'https://idp.example/<tag>',
			status: 'success',
		});
		expect(xml).toContain('https://sp.example/slo?a=1&amp;b=2');
		expect(xml).toContain('&lt;tag&gt;');
		expect(xml).toContain('InResponseTo="_req&lt;&amp;&quot;&gt;"');
		expect(xml).not.toContain('&b=2"'); // raw ampersand not present
	});
});
