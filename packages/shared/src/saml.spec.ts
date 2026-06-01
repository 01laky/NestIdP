import { describe, expect, it } from 'vitest';
import {
	RELAY_STATE_POST_FIELD,
	RELAY_STATE_QUERY_PARAM,
	SAML_METADATA_PATH,
	SAML_REQUEST_QUERY_PARAM,
	SAML_RESPONSE_POST_FIELD,
	SAML_SSO_PATH,
	SP_CONNECTIONS_API_PATH,
	type SpAttributeMappingConfig,
} from './saml.js';

describe('saml shared', () => {
	it('SH-SAML-01: SAML path constants', () => {
		expect(SAML_METADATA_PATH).toBe('/saml/metadata');
		expect(SAML_SSO_PATH).toBe('/saml/sso');
		expect(SP_CONNECTIONS_API_PATH).toBe('/api/admin/sp-connections');
	});

	it('SH-SAML-02: binding query and POST field names', () => {
		expect(SAML_REQUEST_QUERY_PARAM).toBe('SAMLRequest');
		expect(RELAY_STATE_QUERY_PARAM).toBe('RelayState');
		expect(SAML_RESPONSE_POST_FIELD).toBe('SAMLResponse');
		expect(RELAY_STATE_POST_FIELD).toBe('RelayState');
	});

	it('SH-SAML-03: SpAttributeMappingConfig shape', () => {
		const sample: SpAttributeMappingConfig = {
			nameId: { source: 'email' },
			attributes: [{ samlName: 'memberOf', source: 'groups' }],
		};
		expect(sample.attributes?.[0]?.samlName).toBe('memberOf');
	});
});
