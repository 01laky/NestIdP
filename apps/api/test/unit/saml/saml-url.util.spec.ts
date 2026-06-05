import {
	getExpectedSsoDestination,
	normalizeUrlForComparison,
	validateAcsUrl,
} from '@api/saml/utils/saml-url.util';

describe('saml-url.util', () => {
	it('API-SAML-URL-01: normalizeUrlForComparison strips trailing slashes', () => {
		expect(normalizeUrlForComparison('http://localhost:3000/saml/sso/')).toBe(
			'http://localhost:3000/saml/sso',
		);
	});

	it('API-SAML-URL-02: getExpectedSsoDestination uses IDP base', () => {
		expect(getExpectedSsoDestination('http://localhost:3000/')).toBe(
			'http://localhost:3000/saml/sso',
		);
	});

	it('API-SAML-URL-03: validateAcsUrl rejects invalid URL', () => {
		expect(() => validateAcsUrl('not-a-url', 'development')).toThrow('Invalid ACS URL');
	});

	it('API-SAML-URL-04: validateAcsUrl requires HTTPS in production', () => {
		expect(() => validateAcsUrl('http://sp.example.com/acs', 'production')).toThrow(
			'ACS URL must use HTTPS in production',
		);
		expect(() => validateAcsUrl('https://sp.example.com/acs', 'production')).not.toThrow();
	});
});
