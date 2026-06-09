import { escapeXmlAttr, escapeXmlText } from '@api/saml/utils/saml-xml.util';

/**
 * Edge-case coverage for the shared XML-escaping helpers (Prompt 38 §A4/§6). These guard every value
 * interpolated into hand-built SAML LogoutRequest/Response messages, so the escaping must be correct AND
 * injection-safe for adversarial SP/user data (entity IDs, NameIDs, session indices).
 */
describe('escapeXmlText (§A4)', () => {
	it('SAML-XML-01: escapes the three text-significant characters', () => {
		expect(escapeXmlText('&')).toBe('&amp;');
		expect(escapeXmlText('<')).toBe('&lt;');
		expect(escapeXmlText('>')).toBe('&gt;');
	});

	it('SAML-XML-02: ampersand is escaped FIRST so output is never double-escaped', () => {
		// Wrong ordering would turn `<` into `&lt;` then the `&` into `&amp;lt;`.
		expect(escapeXmlText('<&>')).toBe('&lt;&amp;&gt;');
		expect(escapeXmlText('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
	});

	it('SAML-XML-03: a pre-existing entity is treated as literal text (its & is escaped)', () => {
		expect(escapeXmlText('&amp;')).toBe('&amp;amp;');
		expect(escapeXmlText('&#x41;')).toBe('&amp;#x41;');
	});

	it('SAML-XML-04: neutralises an XML-injection payload', () => {
		const payload = '</saml:Issuer><Evil>pwn</Evil>';
		expect(escapeXmlText(payload)).toBe('&lt;/saml:Issuer&gt;&lt;Evil&gt;pwn&lt;/Evil&gt;');
		expect(escapeXmlText(payload)).not.toContain('<');
		expect(escapeXmlText(payload)).not.toContain('>');
	});

	it('SAML-XML-05: does NOT escape quotes (text context only)', () => {
		expect(escapeXmlText('say "hi" and \'bye\'')).toBe('say "hi" and \'bye\'');
	});

	it('SAML-XML-06: leaves ordinary / empty / unicode text untouched and preserves newlines+tabs', () => {
		expect(escapeXmlText('')).toBe('');
		expect(escapeXmlText('urn:example:sp:42')).toBe('urn:example:sp:42');
		expect(escapeXmlText('Ünïcödé 日本語 🔐')).toBe('Ünïcödé 日本語 🔐');
		expect(escapeXmlText('line1\nline2\tcol')).toBe('line1\nline2\tcol');
	});

	it('SAML-XML-07: escapes every occurrence, not just the first', () => {
		expect(escapeXmlText('&&&')).toBe('&amp;&amp;&amp;');
		expect(escapeXmlText('<<<>>>')).toBe('&lt;&lt;&lt;&gt;&gt;&gt;');
	});
});

describe('escapeXmlAttr (§A4)', () => {
	it('SAML-XML-08: escapes the double quote in addition to text escaping', () => {
		expect(escapeXmlAttr('"')).toBe('&quot;');
		expect(escapeXmlAttr('a"b')).toBe('a&quot;b');
	});

	it('SAML-XML-09: escapes &, <, >, and " together with correct ordering', () => {
		expect(escapeXmlAttr('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
	});

	it('SAML-XML-10: neutralises an attribute-breakout injection', () => {
		const payload = '" onload="alert(1)';
		const escaped = escapeXmlAttr(payload);
		expect(escaped).toBe('&quot; onload=&quot;alert(1)');
		expect(escaped).not.toContain('"');
	});

	it('SAML-XML-11: single quotes are left intact (double-quoted attribute context)', () => {
		expect(escapeXmlAttr("it's fine")).toBe("it's fine");
	});

	it('SAML-XML-12: empty and quote-free attribute values are unchanged', () => {
		expect(escapeXmlAttr('')).toBe('');
		expect(escapeXmlAttr('_idp-entity-id')).toBe('_idp-entity-id');
	});
});
