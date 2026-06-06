import { describe, expect, it } from 'vitest';
import {
	SIGNATURE_QUERY_PARAM,
	SIG_ALG_QUERY_PARAM,
	SAML_REDIRECT_SIGNATURE_ALGORITHMS,
	getSamlRedirectSignatureAlgorithm,
} from '@shared/saml.js';

describe('saml redirect signature shared', () => {
	it('SH-SAML-REQ-SIG-01: redirect signature query parameter names are stable', () => {
		expect(SIG_ALG_QUERY_PARAM).toBe('SigAlg');
		expect(SIGNATURE_QUERY_PARAM).toBe('Signature');
	});

	it('SH-SAML-REQ-SIG-02: algorithm lookup supports id and URI values', () => {
		const byId = getSamlRedirectSignatureAlgorithm('rsa-sha256');
		const byUri = getSamlRedirectSignatureAlgorithm(
			'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		);
		expect(byId?.xmlSignatureAlgorithm).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
		expect(byUri?.id).toBe('rsa-sha256');
		expect(SAML_REDIRECT_SIGNATURE_ALGORITHMS.length).toBeGreaterThan(0);
	});

	it('SH-SAML-REQ-SIG-03: unknown or empty algorithms are rejected', () => {
		expect(getSamlRedirectSignatureAlgorithm('rsa-md5')).toBeUndefined();
		expect(getSamlRedirectSignatureAlgorithm('')).toBeUndefined();
		expect(getSamlRedirectSignatureAlgorithm(null)).toBeUndefined();
	});
});
