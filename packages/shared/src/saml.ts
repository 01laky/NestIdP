/** Public SAML HTTP paths (Nest controllers use these segments). */
export const SAML_METADATA_PATH = '/saml/metadata';
export const SAML_SSO_PATH = '/saml/sso';

/** Query params on SP → IdP redirect (SAML 2.0 HTTP-Redirect). */
export const SAML_REQUEST_QUERY_PARAM = 'SAMLRequest';
export const RELAY_STATE_QUERY_PARAM = 'RelayState';

/** POST field names for HTTP-POST binding to SP ACS. */
export const SAML_RESPONSE_POST_FIELD = 'SAMLResponse';
export const RELAY_STATE_POST_FIELD = 'RelayState';

/** Admin REST — read-only SP connections (v0.7.0). */
export const SP_CONNECTIONS_API_PATH = '/api/admin/sp-connections';

export type SpAttributeMappingConfig = {
	nameId?: { source: 'email' | 'username'; format?: string };
	attributes?: Array<{
		samlName: string;
		source: 'email' | 'displayName' | 'username' | 'groups' | 'roles';
		nameFormat?: string;
	}>;
};

/** Parsed AuthnRequest fields needed downstream (no raw XML in DTO). */
export interface ParsedAuthnRequestDto {
	id: string;
	issuer: string;
	destination?: string;
	issueInstant: string;
	protocolBinding?: string;
}

export interface ParseRedirectBindingResult {
	authnRequest: ParsedAuthnRequestDto;
	relayState?: string;
}

/** Admin helper — public IdP metadata URL. */
export const IDP_METADATA_URL_API_PATH = '/api/admin/idp/metadata-url';

export interface SpConnectionPublicDto {
	id: string;
	name: string;
	spEntityId: string;
	acsUrl: string;
	nameIdFormat: string;
	attributeMapping: SpAttributeMappingConfig | null;
	active: boolean;
	hasSpCertificate: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface SpConnectionListResponseDto {
	items: SpConnectionPublicDto[];
}

export interface IdpMetadataUrlResponseDto {
	metadataUrl: string;
	entityId: string;
	ssoUrl: string;
}
