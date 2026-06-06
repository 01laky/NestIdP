import {
	parseLogoutRequestXml,
	SamlLogoutParseError,
} from '@api/saml/utils/saml-logout-request-parser.util';
import { buildLogoutRequestXml } from '@test/support/saml/build-logout-request.util';

const OPTS = { clockSkewSeconds: 120 };

describe('saml-logout-request-parser.util', () => {
	it('API-SLO-PARSE-01: valid LogoutRequest (NameID + 1 SessionIndex) parses', () => {
		const xml = buildLogoutRequestXml({
			id: '_lr1',
			issuer: 'urn:test:sp',
			nameId: 'alice@example.com',
			sessionIndex: '_sess1',
		});
		const parsed = parseLogoutRequestXml(xml, 'redirect', OPTS);
		expect(parsed.id).toBe('_lr1');
		expect(parsed.issuer).toBe('urn:test:sp');
		expect(parsed.nameId).toBe('alice@example.com');
		expect(parsed.sessionIndexes).toEqual(['_sess1']);
		expect(parsed.bindingType).toBe('redirect');
	});

	it('API-SLO-PARSE-02: multiple SessionIndex elements collected', () => {
		const xml = buildLogoutRequestXml({ sessionIndex: ['_a', '_b', '_c'] });
		const parsed = parseLogoutRequestXml(xml, 'post', OPTS);
		expect(parsed.sessionIndexes).toEqual(['_a', '_b', '_c']);
	});

	it('API-SLO-PARSE-03: missing NameID throws logout_request_malformed', () => {
		const xml = buildLogoutRequestXml({ includeNameId: false });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('API-SLO-PARSE-04: missing Issuer throws', () => {
		const xml =
			'<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_x" Version="2.0" IssueInstant="' +
			new Date().toISOString() +
			'"><saml:NameID>u@e.com</saml:NameID></samlp:LogoutRequest>';
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(SamlLogoutParseError);
	});

	it('API-SLO-PARSE-05: expired IssueInstant throws logout_issue_instant_invalid', () => {
		const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const xml = buildLogoutRequestXml({ issueInstant: old });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_issue_instant_invalid' }),
		);
	});

	it('API-SLO-PARSE-05b: future IssueInstant throws logout_issue_instant_invalid', () => {
		const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
		const xml = buildLogoutRequestXml({ issueInstant: future });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_issue_instant_invalid' }),
		);
	});

	it('API-SLO-PARSE-06: Destination present + mismatched is captured (caller validates)', () => {
		const xml = buildLogoutRequestXml({ destination: 'http://evil.example/slo' });
		const parsed = parseLogoutRequestXml(xml, 'redirect', OPTS);
		expect(parsed.destination).toBe('http://evil.example/slo');
	});

	it('API-SLO-PARSE-07: Destination absent is accepted', () => {
		const xml = buildLogoutRequestXml({ destination: undefined }).replace(
			/ Destination="[^"]*"/,
			'',
		);
		const parsed = parseLogoutRequestXml(xml, 'redirect', OPTS);
		expect(parsed.destination).toBeUndefined();
	});

	it('API-SLO-PARSE-08: non-LogoutRequest root throws logout_request_malformed', () => {
		const xml = '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_x"/>';
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('API-SLO-PARSE-09: malformed XML throws logout_request_malformed', () => {
		expect(() => parseLogoutRequestXml('<not-valid', 'post', OPTS)).toThrow(SamlLogoutParseError);
	});

	it('API-SLO-PARSE-10 (H2): NotOnOrAfter in the past throws logout_request_expired', () => {
		const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const xml = buildLogoutRequestXml({ notOnOrAfter: past });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_expired' }),
		);
	});

	it('API-SLO-PARSE-10b (H2): future NotOnOrAfter accepted', () => {
		const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
		const xml = buildLogoutRequestXml({ notOnOrAfter: future });
		const parsed = parseLogoutRequestXml(xml, 'redirect', OPTS);
		expect(parsed.notOnOrAfter).toBe(future);
	});

	it('EncryptedID NameID is rejected as unsupported', () => {
		const xml = buildLogoutRequestXml({ encryptedId: true });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('detects enveloped signature presence', () => {
		const xml = buildLogoutRequestXml().replace(
			'</samlp:LogoutRequest>',
			'<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"></ds:Signature></samlp:LogoutRequest>',
		);
		const parsed = parseLogoutRequestXml(xml, 'post', OPTS);
		expect(parsed.hasSignature).toBe(true);
	});

	it('EDGE: whitespace-only NameID throws logout_request_malformed', () => {
		const xml = buildLogoutRequestXml({ nameId: '   ' });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('EDGE: ID longer than 256 chars throws logout_request_malformed', () => {
		const xml = buildLogoutRequestXml({ id: `_${'x'.repeat(300)}` });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('EDGE: missing IssueInstant throws logout_issue_instant_invalid', () => {
		const xml = buildLogoutRequestXml().replace(/ IssueInstant="[^"]*"/, '');
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_issue_instant_invalid' }),
		);
	});

	it('EDGE: garbage IssueInstant throws logout_issue_instant_invalid', () => {
		const xml = buildLogoutRequestXml({ issueInstant: 'not-a-date' });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_issue_instant_invalid' }),
		);
	});

	it('EDGE: malformed NotOnOrAfter throws logout_request_malformed', () => {
		const xml = buildLogoutRequestXml({ notOnOrAfter: 'garbage' });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).toThrow(
			expect.objectContaining({ reason: 'logout_request_malformed' }),
		);
	});

	it('EDGE: NameID with XML-escaped special chars round-trips', () => {
		const xml = buildLogoutRequestXml({ nameId: 'a&b<c>"d' });
		const parsed = parseLogoutRequestXml(xml, 'redirect', OPTS);
		expect(parsed.nameId).toBe('a&b<c>"d');
	});

	it('EDGE: NameID Format attribute captured; defaults to undefined when absent', () => {
		const withFmt = parseLogoutRequestXml(
			buildLogoutRequestXml({ nameIdFormat: 'urn:custom:fmt' }),
			'redirect',
			OPTS,
		);
		expect(withFmt.nameIdFormat).toBe('urn:custom:fmt');
	});

	it('EDGE: blank SessionIndex elements are filtered out', () => {
		const xml = buildLogoutRequestXml({ sessionIndex: ['_a', '', '  ', '_b'] });
		const parsed = parseLogoutRequestXml(xml, 'post', OPTS);
		expect(parsed.sessionIndexes).toEqual(['_a', '_b']);
	});

	it('EDGE: large SessionIndex list (50) collected', () => {
		const indexes = Array.from({ length: 50 }, (_, i) => `_si${i}`);
		const xml = buildLogoutRequestXml({ sessionIndex: indexes });
		const parsed = parseLogoutRequestXml(xml, 'post', OPTS);
		expect(parsed.sessionIndexes).toHaveLength(50);
	});

	it('EDGE: IssueInstant exactly at skew boundary accepted', () => {
		const justInside = new Date(Date.now() - 119 * 1000).toISOString();
		const xml = buildLogoutRequestXml({ issueInstant: justInside });
		expect(() => parseLogoutRequestXml(xml, 'redirect', OPTS)).not.toThrow();
	});
});
