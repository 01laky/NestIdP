import { extractSloUrlFromSpMetadata } from '@api/saml/utils/sp-metadata-slo.util';
import { extractSpMetadata } from '@api/saml/utils/sp-metadata.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

// A real, parseable signing certificate — strip the PEM armor to get the base64 DER body that
// metadata carries inside <ds:X509Certificate>.
const REAL_CERT_PEM = getTestSigningMaterial('urn:test:sp-metadata-util').certPem.trim();
const CERT_BODY = REAL_CERT_PEM.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(
	/\s+/g,
	'',
);
const OTHER_CERT_BODY = getTestSigningMaterial('urn:test:sp-metadata-util-2')
	.certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
	.replace(/\s+/g, '');

const RED = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const SOAP = 'urn:oasis:names:tc:SAML:2.0:bindings:SOAP';

function entityDescriptor(inner: string, attrs = 'entityID="https://sp.example.com/sp"'): string {
	return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ${attrs}>
  ${inner}
</md:EntityDescriptor>`;
}

function spsso(inner: string, attrs = ''): string {
	return `<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" ${attrs}>${inner}</md:SPSSODescriptor>`;
}

function keyDescriptor(body: string, use?: string): string {
	const useAttr = use ? ` use="${use}"` : '';
	return `<md:KeyDescriptor${useAttr}><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;
}

describe('extractSpMetadata (Prompt 42)', () => {
	it('SPM-PARSE-01: full EntityDescriptor → entityID, all ACS, SLO trio, NameID formats, signing cert', () => {
		const xml = entityDescriptor(
			spsso(
				keyDescriptor(CERT_BODY, 'signing') +
					`<md:SingleLogoutService Binding="${RED}" Location="https://sp.example.com/slo/redirect"/>` +
					`<md:SingleLogoutService Binding="${POST}" Location="https://sp.example.com/slo/post"/>` +
					`<md:SingleLogoutService Binding="${SOAP}" Location="https://sp.example.com/slo/soap"/>` +
					`<md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>` +
					`<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>` +
					`<md:AssertionConsumerService Binding="${RED}" Location="https://sp.example.com/acs-r" index="1"/>` +
					`<md:AssertionConsumerService Binding="${POST}" Location="https://sp.example.com/acs-p" index="0" isDefault="true"/>`,
				'AuthnRequestsSigned="true" WantAssertionsSigned="true"',
			),
		);
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBe('https://sp.example.com/sp');
		expect(r.acs).toEqual([
			{ binding: RED, location: 'https://sp.example.com/acs-r', index: 1, isDefault: false },
			{ binding: POST, location: 'https://sp.example.com/acs-p', index: 0, isDefault: true },
		]);
		expect(r.slo).toEqual({
			redirect: 'https://sp.example.com/slo/redirect',
			post: 'https://sp.example.com/slo/post',
			soap: 'https://sp.example.com/slo/soap',
		});
		expect(r.nameIdFormats).toEqual([
			'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		]);
		expect(r.authnRequestsSigned).toBe(true);
		expect(r.wantAssertionsSigned).toBe(true);
		expect(r.signingCertificates).toHaveLength(1);
		// The extracted PEM re-wraps to exactly the cert body that was in the metadata.
		expect(
			r.signingCertificates[0]
				.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
				.replace(/\s+/g, ''),
		).toBe(CERT_BODY);
		expect(r.signingCertificates[0]).toContain('BEGIN CERTIFICATE');
	});

	it('SPM-PARSE-02: extractSloUrlFromSpMetadata still returns the same {redirect,post,soap} (delegation)', () => {
		const xml = entityDescriptor(
			spsso(
				`<md:SingleLogoutService Binding="${RED}" Location="https://sp.example/slo/r"/>` +
					`<md:SingleLogoutService Binding="${POST}" Location="https://sp.example/slo/p"/>`,
			),
		);
		expect(extractSloUrlFromSpMetadata(xml)).toEqual({
			redirect: 'https://sp.example/slo/r',
			post: 'https://sp.example/slo/p',
			soap: null,
		});
		// Identical to the slo field of the full parse.
		expect(extractSloUrlFromSpMetadata(xml)).toEqual(extractSpMetadata(xml).slo);
	});

	it('SPM-PARSE-03: use="signing" and no-use are signing; use="encryption"-only is not taken', () => {
		const signingPlusEnc = extractSpMetadata(
			entityDescriptor(
				spsso(keyDescriptor(CERT_BODY, 'signing') + keyDescriptor(OTHER_CERT_BODY, 'encryption')),
			),
		);
		expect(signingPlusEnc.signingCertificates).toHaveLength(1);

		const noUse = extractSpMetadata(entityDescriptor(spsso(keyDescriptor(CERT_BODY))));
		expect(noUse.signingCertificates).toHaveLength(1);

		const encOnly = extractSpMetadata(
			entityDescriptor(spsso(keyDescriptor(CERT_BODY, 'encryption'))),
		);
		expect(encOnly.signingCertificates).toHaveLength(0);
	});

	it('SPM-PARSE-04: multiple signing certs (rollover) returned in document order', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(keyDescriptor(CERT_BODY, 'signing') + keyDescriptor(OTHER_CERT_BODY, 'signing')),
			),
		);
		expect(r.signingCertificates).toHaveLength(2);
		const bodies = r.signingCertificates.map((p) =>
			p.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
		);
		expect(bodies).toEqual([CERT_BODY, OTHER_CERT_BODY]);
	});

	it('SPM-PARSE-05: EntitiesDescriptor wrapper → the entity with an SPSSODescriptor is chosen', () => {
		const xml = `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:EntityDescriptor entityID="urn:idp:only">
    <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"/>
  </md:EntityDescriptor>
  <md:EntityDescriptor entityID="urn:sp:real">
    ${spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`)}
  </md:EntityDescriptor>
</md:EntitiesDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBe('urn:sp:real');
		expect(r.entityCount).toBe(2);
		expect(r.acs).toHaveLength(1);
	});

	it('SPM-PARSE-06: metadata with no SPSSODescriptor → valid:false', () => {
		const xml = entityDescriptor(
			'<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"/>',
		);
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(false);
		expect(r.entityId).toBeNull();
		expect(r.acs).toEqual([]);
	});

	it('SPM-PARSE-07: malformed / empty XML → empty result, never throws', () => {
		for (const bad of ['', '   ', '<not-xml', '<md:EntityDescriptor>unclosed', 'plain text']) {
			expect(() => extractSpMetadata(bad)).not.toThrow();
			expect(extractSpMetadata(bad).valid).toBe(false);
		}
	});

	it('SPM-PARSE-08: a DOCTYPE / external-entity (XXE) document is rejected and no entity is resolved', () => {
		const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/hostname">]>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="&xxe;">
  ${spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`)}
</md:EntityDescriptor>`;
		const r = extractSpMetadata(xxe);
		expect(r.valid).toBe(false);
		expect(r.entityId).toBeNull();
		// Nothing from the document (no file contents, no entity) leaks through.
		expect(r.acs).toEqual([]);
	});

	it('SPM-PARSE-08b: oversized input is rejected without parsing', () => {
		const huge = entityDescriptor(spsso('')) + '<!-- ' + 'x'.repeat(600 * 1024) + ' -->';
		expect(extractSpMetadata(huge).valid).toBe(false);
	});

	it('SPM-PARSE-09: enveloped-signed metadata still parses; signed=true', () => {
		const xml = entityDescriptor(
			`<ds:Signature><ds:SignedInfo/></ds:Signature>` +
				spsso(
					`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`,
				),
		);
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.signed).toBe(true);
		expect(r.acs).toHaveLength(1);
	});

	it('SPM-PARSE-10: validUntil and a garbage cert body are surfaced as-is (resolver validates certs)', () => {
		const xml = entityDescriptor(
			spsso(keyDescriptor('!!!not-base64!!!', 'signing')),
			'entityID="urn:sp:x" validUntil="2020-01-01T00:00:00Z"',
		);
		const r = extractSpMetadata(xml);
		expect(r.validUntil).toBe('2020-01-01T00:00:00Z');
		// Non-base64 body is dropped at the PEM-wrapping step (not a valid base64 char set).
		expect(r.signingCertificates).toEqual([]);
	});

	it('SPM-PARSE-11: ACS without index → index null; isDefault defaults false', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs"/>`),
			),
		);
		expect(r.acs).toEqual([
			{ binding: POST, location: 'https://sp/acs', index: null, isDefault: false },
		]);
	});

	it('SPM-PARSE-12: round-trips NestIdP sp-app metadata shape (signing+encryption KeyDescriptors, dual SLO, POST ACS)', () => {
		// Mirrors sp-app/src/saml/metadata.mjs buildSpMetadata output.
		const xml = entityDescriptor(
			spsso(
				keyDescriptor(CERT_BODY, 'signing') +
					keyDescriptor(OTHER_CERT_BODY, 'encryption') +
					`<md:SingleLogoutService Binding="${RED}" Location="https://sp.example.com/slo"/>` +
					`<md:SingleLogoutService Binding="${POST}" Location="https://sp.example.com/slo"/>` +
					`<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>` +
					`<md:AssertionConsumerService Binding="${POST}" Location="https://sp.example.com/acs" index="0" isDefault="true"/>`,
				'AuthnRequestsSigned="true" WantAssertionsSigned="true"',
			),
		);
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.acs).toEqual([
			{ binding: POST, location: 'https://sp.example.com/acs', index: 0, isDefault: true },
		]);
		expect(r.slo.redirect).toBe('https://sp.example.com/slo');
		expect(r.slo.post).toBe('https://sp.example.com/slo');
		// Only the signing KeyDescriptor is taken (the encryption one is ignored).
		expect(r.signingCertificates).toHaveLength(1);
		expect(
			r.signingCertificates[0]
				.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
				.replace(/\s+/g, ''),
		).toBe(CERT_BODY);
		expect(r.authnRequestsSigned).toBe(true);
		expect(r.wantAssertionsSigned).toBe(true);
	});

	// --- Real-world XML shape variations -----------------------------------------------------------

	it('SPM-PARSE-13: a non-md prefix bound to the SAML metadata namespace still parses (prefix-agnostic)', () => {
		// Azure AD / ADFS often use a different prefix (or the default namespace) for the metadata NS.
		const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:dsig="http://www.w3.org/2000/09/xmldsig#" entityID="https://sp.azure/sp">
  <SPSSODescriptor AuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing"><dsig:KeyInfo><dsig:X509Data><dsig:X509Certificate>${CERT_BODY}</dsig:X509Certificate></dsig:X509Data></dsig:KeyInfo></KeyDescriptor>
    <AssertionConsumerService Binding="${POST}" Location="https://sp.azure/acs" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBe('https://sp.azure/sp');
		expect(r.acs).toHaveLength(1);
		expect(r.signingCertificates).toHaveLength(1);
		expect(r.authnRequestsSigned).toBe(true);
	});

	it('SPM-PARSE-14: a custom prefix (saml2md) bound to the metadata namespace still parses', () => {
		const xml = `<?xml version="1.0"?>
<saml2md:EntityDescriptor xmlns:saml2md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:sp:custompfx">
  <saml2md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <saml2md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>
  </saml2md:SPSSODescriptor>
</saml2md:EntityDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBe('urn:sp:custompfx');
		expect(r.acs).toHaveLength(1);
	});

	it('SPM-PARSE-15: X509Certificate body with embedded whitespace/newlines is normalized to PEM', () => {
		const wrapped = CERT_BODY.match(/.{1,40}/g)!.join('\n  '); // inject newlines + indentation
		const r = extractSpMetadata(
			entityDescriptor(spsso(keyDescriptor(`\n  ${wrapped}\n`, 'signing'))),
		);
		expect(r.signingCertificates).toHaveLength(1);
		expect(
			r.signingCertificates[0]
				.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
				.replace(/\s+/g, ''),
		).toBe(CERT_BODY);
	});

	it('SPM-PARSE-16: X509Certificate already carrying PEM armor inside the element is still accepted', () => {
		const r = extractSpMetadata(entityDescriptor(spsso(keyDescriptor(REAL_CERT_PEM, 'signing'))));
		expect(r.signingCertificates).toHaveLength(1);
		expect(
			r.signingCertificates[0]
				.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
				.replace(/\s+/g, ''),
		).toBe(CERT_BODY);
	});

	it('SPM-PARSE-17: a signing KeyDescriptor with no X509Certificate yields no cert (no throw)', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso('<md:KeyDescriptor use="signing"><ds:KeyInfo></ds:KeyInfo></md:KeyDescriptor>'),
			),
		);
		expect(r.valid).toBe(true);
		expect(r.signingCertificates).toEqual([]);
	});

	it('SPM-PARSE-18: missing entityID → entityId null but still valid when an SPSSODescriptor is present', () => {
		const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">
  ${spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`)}
</md:EntityDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBeNull();
	});

	it('SPM-PARSE-19: ACS index attributes — non-numeric → null; isDefault="false" → false', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(
					`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/a" index="abc" isDefault="false"/>` +
						`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/b" index="02"/>`,
				),
			),
		);
		expect(r.acs[0]).toEqual({
			binding: POST,
			location: 'https://sp/a',
			index: null,
			isDefault: false,
		});
		expect(r.acs[1].index).toBe(2);
	});

	it('SPM-PARSE-20: NameIDFormat values are trimmed; SLO can be SOAP-only', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(
					`<md:SingleLogoutService Binding="${SOAP}" Location="https://sp/slo/soap"/>` +
						`<md:NameIDFormat>  urn:oasis:names:tc:SAML:2.0:nameid-format:transient  </md:NameIDFormat>`,
				),
			),
		);
		expect(r.nameIdFormats).toEqual(['urn:oasis:names:tc:SAML:2.0:nameid-format:transient']);
		expect(r.slo).toEqual({ redirect: null, post: null, soap: 'https://sp/slo/soap' });
	});

	it('SPM-PARSE-21: AuthnRequestsSigned/WantAssertionsSigned — "1" is truthy, absent is false', () => {
		const truthy = extractSpMetadata(
			entityDescriptor(spsso('', 'AuthnRequestsSigned="1" WantAssertionsSigned="1"')),
		);
		expect(truthy.authnRequestsSigned).toBe(true);
		expect(truthy.wantAssertionsSigned).toBe(true);

		const absent = extractSpMetadata(entityDescriptor(spsso('')));
		expect(absent.authnRequestsSigned).toBe(false);
		expect(absent.wantAssertionsSigned).toBe(false);
	});

	it('SPM-PARSE-22: validUntil falls back to the EntitiesDescriptor attribute when the entity lacks it', () => {
		const xml = `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" validUntil="2031-01-01T00:00:00Z">
  <md:EntityDescriptor entityID="urn:sp:fed">
    ${spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`)}
  </md:EntityDescriptor>
</md:EntitiesDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.validUntil).toBe('2031-01-01T00:00:00Z');
	});

	it('SPM-PARSE-23: an EntitiesDescriptor-level ds:Signature marks the result signed', () => {
		const xml = `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:Signature><ds:SignedInfo/></ds:Signature>
  <md:EntityDescriptor entityID="urn:sp:signedfed">
    ${spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`)}
  </md:EntityDescriptor>
</md:EntitiesDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.signed).toBe(true);
	});

	it('SPM-PARSE-24: an XML declaration followed by a comment is tolerated', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported by the SP -->\n<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:sp:cmt">${spsso(
			`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`,
		)}</md:EntityDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.acs).toHaveLength(1);
	});

	it('SPM-PARSE-24b: leading whitespace before the root element (no declaration) is tolerated', () => {
		const xml = `\n\n  <md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:sp:ws">${spsso(
			`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`,
		)}</md:EntityDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.valid).toBe(true);
		expect(r.entityId).toBe('urn:sp:ws');
	});

	it('SPM-PARSE-25: two SP EntityDescriptors → the first is chosen, entityCount reflects both', () => {
		const xml = `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">
  <md:EntityDescriptor entityID="urn:sp:first">${spsso(
		`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/first/acs" index="0"/>`,
	)}</md:EntityDescriptor>
  <md:EntityDescriptor entityID="urn:sp:second">${spsso(
		`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/second/acs" index="0"/>`,
	)}</md:EntityDescriptor>
</md:EntitiesDescriptor>`;
		const r = extractSpMetadata(xml);
		expect(r.entityId).toBe('urn:sp:first');
		expect(r.entityCount).toBe(2);
		expect(r.acs[0].location).toBe('https://sp/first/acs');
	});

	it('SPM-PARSE-26: SLO Location-less entries and duplicate bindings — first wins, missing Location skipped', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(
					`<md:SingleLogoutService Binding="${RED}"/>` + // no Location → skipped
						`<md:SingleLogoutService Binding="${RED}" Location="https://sp/slo/r1"/>` +
						`<md:SingleLogoutService Binding="${RED}" Location="https://sp/slo/r2"/>`,
				),
			),
		);
		expect(r.slo.redirect).toBe('https://sp/slo/r1');
	});

	it('SPM-PARSE-27: ACS missing Binding or Location is skipped', () => {
		const r = extractSpMetadata(
			entityDescriptor(
				spsso(
					`<md:AssertionConsumerService Location="https://sp/no-binding" index="0"/>` +
						`<md:AssertionConsumerService Binding="${POST}" index="1"/>` +
						`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/ok" index="2"/>`,
				),
			),
		);
		expect(r.acs).toEqual([
			{ binding: POST, location: 'https://sp/ok', index: 2, isDefault: false },
		]);
	});

	it('SPM-PARSE-28: a lone <!DOCTYPE> with no entities is also rejected (defensive)', () => {
		const xml = `<?xml version="1.0"?><!DOCTYPE EntityDescriptor>
${entityDescriptor(spsso(`<md:AssertionConsumerService Binding="${POST}" Location="https://sp/acs" index="0"/>`))}`;
		expect(extractSpMetadata(xml).valid).toBe(false);
	});
});
