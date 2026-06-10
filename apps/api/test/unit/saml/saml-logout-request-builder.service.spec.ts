import { SamlLogoutRequestBuilderService } from '@api/saml/services/saml-logout-request-builder.service';
import { IdpSigningService, type SigningMaterial } from '@api/saml/services/idp-signing.service';
import { verifyEnvelopedXmlDsig } from '@api/saml/utils/saml-enveloped-signature.util';
import { verifySamlXmlSignature } from '@test/support/saml/verify-saml-signature.util';
import {
	generateTestSpSigningKeyPair,
	generateTestEcSigningKeyPair,
} from '@test/support/saml/build-logout-request.util';

/**
 * Back-channel (SOAP) SLO outbound LogoutRequest builder + signing (Prompt 36, BC-BUILD).
 * Pure builder + the enveloped XML-DSig signing path (`IdpSigningService.signLogoutRequest`). No DB.
 */
describe('SamlLogoutRequestBuilderService + signLogoutRequest (BC-BUILD)', () => {
	const builder = new SamlLogoutRequestBuilderService();
	// IdpSigningService.signLogoutRequest does not touch any injected dependency — empty deps are safe.
	const idpSigning = new IdpSigningService({} as never, {} as never, {} as never, {} as never);

	let rsaMaterial: SigningMaterial;
	let ecMaterial: SigningMaterial;

	beforeAll(() => {
		const rsa = generateTestSpSigningKeyPair('idp-bc');
		rsaMaterial = { ...rsa, signatureAlgorithmId: 'rsa-sha256' };
		const ec = generateTestEcSigningKeyPair('idp-bc-ec');
		ecMaterial = { ...ec, signatureAlgorithmId: 'ecdsa-sha256' };
	});

	const baseInput = {
		requestId: '_bc-req-001',
		destination: 'https://sp.example.com/slo/soap',
		idpEntityId: 'https://idp.example.com',
		nameId: 'alice@example.com',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		sessionIndexes: ['_sidx-1'],
		validitySeconds: 300,
	};

	it('BC-BUILD-01: emits Issuer / NameID+Format / SessionIndex / Destination / ID / IssueInstant / NotOnOrAfter / Version', () => {
		const { xml, requestId } = builder.build(baseInput);
		expect(requestId).toBe('_bc-req-001');
		expect(xml).toContain('<samlp:LogoutRequest');
		expect(xml).toContain('ID="_bc-req-001"');
		expect(xml).toContain('Version="2.0"');
		expect(xml).toContain('Destination="https://sp.example.com/slo/soap"');
		expect(xml).toContain('<saml2:Issuer>https://idp.example.com</saml2:Issuer>');
		expect(xml).toContain(
			'<saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@example.com</saml2:NameID>',
		);
		expect(xml).toContain('<samlp:SessionIndex>_sidx-1</samlp:SessionIndex>');
		expect(xml).toMatch(/IssueInstant="[^"]+"/);
		expect(xml).toMatch(/NotOnOrAfter="[^"]+"/);
	});

	it('BC-BUILD-01b: NotOnOrAfter = IssueInstant + validitySeconds', () => {
		const { xml } = builder.build({ ...baseInput, validitySeconds: 600 });
		const issue = Date.parse(xml.match(/IssueInstant="([^"]+)"/)![1]);
		const notAfter = Date.parse(xml.match(/NotOnOrAfter="([^"]+)"/)![1]);
		expect(notAfter - issue).toBe(600 * 1000);
	});

	it('BC-BUILD-02: multiple session indexes emit multiple <SessionIndex> elements', () => {
		const { xml } = builder.build({ ...baseInput, sessionIndexes: ['_a', '_b', '_c'] });
		const count = (xml.match(/<samlp:SessionIndex>/g) ?? []).length;
		expect(count).toBe(3);
		expect(xml).toContain('<samlp:SessionIndex>_a</samlp:SessionIndex>');
		expect(xml).toContain('<samlp:SessionIndex>_c</samlp:SessionIndex>');
	});

	it('BC-BUILD-02b: zero session indexes emit no <SessionIndex> element', () => {
		const { xml } = builder.build({ ...baseInput, sessionIndexes: [] });
		expect(xml).not.toContain('<samlp:SessionIndex>');
	});

	it('BC-BUILD-09: empty / whitespace-only NameID throws instead of emitting <NameID/> (§5.C)', () => {
		expect(() => builder.build({ ...baseInput, nameId: '' })).toThrow(
			'LogoutRequest requires a non-empty NameID',
		);
		expect(() => builder.build({ ...baseInput, nameId: '   ' })).toThrow(
			'LogoutRequest requires a non-empty NameID',
		);
	});

	it('BC-BUILD-10: empty / whitespace session indexes are dropped (zero elements is valid SLO)', () => {
		const { xml } = builder.build({ ...baseInput, sessionIndexes: ['', '  ', '_keep'] });
		const count = (xml.match(/<samlp:SessionIndex>/g) ?? []).length;
		expect(count).toBe(1);
		expect(xml).toContain('<samlp:SessionIndex>_keep</samlp:SessionIndex>');
		const { xml: none } = builder.build({ ...baseInput, sessionIndexes: ['', '   '] });
		expect(none).not.toContain('<samlp:SessionIndex>');
	});

	it('BC-BUILD-03: XML-escapes special chars in NameID / Destination / Issuer / SessionIndex', () => {
		const { xml } = builder.build({
			...baseInput,
			nameId: 'a&b<c>"d"',
			destination: 'https://sp.example/slo?x=1&y=2',
			idpEntityId: 'https://idp/<tag>',
			sessionIndexes: ['_s&i'],
		});
		expect(xml).toContain('a&amp;b&lt;c&gt;');
		expect(xml).toContain('x=1&amp;y=2');
		expect(xml).toContain('&lt;tag&gt;');
		expect(xml).toContain('<samlp:SessionIndex>_s&amp;i</samlp:SessionIndex>');
		expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/); // no raw, unescaped ampersand
	});

	it('BC-BUILD-04: signLogoutRequest produces a verifiable enveloped signature (RSA round-trip)', () => {
		const { xml, requestId } = builder.build(baseInput);
		const signed = idpSigning.signLogoutRequest(xml, rsaMaterial, requestId);
		expect(signed).toContain('Signature');
		expect(signed).toContain('SignatureValue');
		expect(verifyEnvelopedXmlDsig(signed, rsaMaterial.certPem)).toBe(true);
	});

	it('BC-BUILD-04b: the <ds:Signature> is placed after <saml2:Issuer>', () => {
		const { xml, requestId } = builder.build(baseInput);
		const signed = idpSigning.signLogoutRequest(xml, rsaMaterial, requestId);
		const issuerIdx = signed.indexOf('</saml2:Issuer>');
		const sigIdx = signed.search(/<(?:[\w-]+:)?Signature[\s>]/);
		expect(issuerIdx).toBeGreaterThan(-1);
		expect(sigIdx).toBeGreaterThan(issuerIdx);
	});

	it('BC-BUILD-05: tampering a signed LogoutRequest breaks verification', () => {
		const { xml, requestId } = builder.build(baseInput);
		const signed = idpSigning.signLogoutRequest(xml, rsaMaterial, requestId);
		const tampered = signed.replace('alice@example.com', 'mallory@evil.example');
		expect(verifyEnvelopedXmlDsig(tampered, rsaMaterial.certPem)).toBe(false);
	});

	it('BC-BUILD-06: verification fails against the wrong certificate', () => {
		const { xml, requestId } = builder.build(baseInput);
		const signed = idpSigning.signLogoutRequest(xml, rsaMaterial, requestId);
		const other = generateTestSpSigningKeyPair('other-idp');
		expect(verifyEnvelopedXmlDsig(signed, other.certPem)).toBe(false);
	});

	it('BC-BUILD-07: EC (ecdsa-sha256) signing round-trips', () => {
		const { xml, requestId } = builder.build(baseInput);
		const signed = idpSigning.signLogoutRequest(xml, ecMaterial, requestId);
		expect(signed).toContain('ecdsa-sha256');
		// EC verification needs the extended algorithm registry (verifyEnvelopedXmlDsig is RSA-only).
		expect(verifySamlXmlSignature(signed, ecMaterial.certPem)).toBe(true);
	});

	it('BC-BUILD-08: the supplied requestId is reused verbatim as the message ID (idempotent retries)', () => {
		const id = '_stable-retry-id-xyz';
		const a = builder.build({ ...baseInput, requestId: id });
		const b = builder.build({ ...baseInput, requestId: id, sessionIndexes: ['_other'] });
		expect(a.requestId).toBe(id);
		expect(b.requestId).toBe(id);
		expect(a.xml).toContain(`ID="${id}"`);
		expect(b.xml).toContain(`ID="${id}"`);
	});
});
