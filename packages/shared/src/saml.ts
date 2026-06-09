/** Public SAML HTTP paths (Nest controllers use these segments). */
export const SAML_METADATA_PATH = '/saml/metadata';
export const SAML_SSO_PATH = '/saml/sso';
export const SAML_SLO_PATH = '/saml/slo';

/** SAML binding URIs. */
export const POST_BINDING_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
export const REDIRECT_BINDING_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
/** SOAP back-channel binding for Single Logout (Prompt 36). */
export const SOAP_BINDING_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:SOAP';

/** Query params on SP → IdP redirect (SAML 2.0 HTTP-Redirect). */
export const SAML_REQUEST_QUERY_PARAM = 'SAMLRequest';
export const RELAY_STATE_QUERY_PARAM = 'RelayState';
export const SIG_ALG_QUERY_PARAM = 'SigAlg';
export const SIGNATURE_QUERY_PARAM = 'Signature';

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
	bindingType?: 'redirect' | 'post';
}

export interface ParseRedirectBindingResult {
	authnRequest: ParsedAuthnRequestDto;
	relayState?: string;
}

export interface SamlRedirectSignatureAlgorithmOption {
	id: string;
	xmlSignatureAlgorithm: string;
	nodeVerifyAlgorithm: string;
}

export const SAML_REDIRECT_SIGNATURE_ALGORITHMS: readonly SamlRedirectSignatureAlgorithmOption[] = [
	{
		id: 'rsa-sha1',
		xmlSignatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
		nodeVerifyAlgorithm: 'RSA-SHA1',
	},
	{
		id: 'rsa-sha256',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		nodeVerifyAlgorithm: 'RSA-SHA256',
	},
	{
		id: 'rsa-sha384',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
		nodeVerifyAlgorithm: 'RSA-SHA384',
	},
	{
		id: 'rsa-sha512',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
		nodeVerifyAlgorithm: 'RSA-SHA512',
	},
	{
		id: 'ecdsa-sha1',
		xmlSignatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#ecdsa-sha1',
		nodeVerifyAlgorithm: 'ecdsa-with-SHA1',
	},
	{
		id: 'ecdsa-sha256',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
		nodeVerifyAlgorithm: 'ecdsa-with-SHA256',
	},
	{
		id: 'ecdsa-sha384',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384',
		nodeVerifyAlgorithm: 'ecdsa-with-SHA384',
	},
	{
		id: 'ecdsa-sha512',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
		nodeVerifyAlgorithm: 'ecdsa-with-SHA512',
	},
] as const;

export function getSamlRedirectSignatureAlgorithm(
	value?: string | null,
): SamlRedirectSignatureAlgorithmOption | undefined {
	if (!value) {
		return undefined;
	}
	return SAML_REDIRECT_SIGNATURE_ALGORITHMS.find(
		(algorithm) => algorithm.id === value || algorithm.xmlSignatureAlgorithm === value,
	);
}

/** Admin helper — public IdP metadata URL. */
export const IDP_METADATA_URL_API_PATH = '/api/admin/idp/metadata-url';

export interface SpConnectionPublicDto {
	id: string;
	name: string;
	spEntityId: string;
	acsUrl: string;
	sloUrl: string | null;
	/** SP SOAP SLO endpoint for back-channel logout (Prompt 36); null = front-channel only. */
	sloSoapUrl?: string | null;
	nameIdFormat: string;
	attributeMapping: SpAttributeMappingConfig | null;
	active: boolean;
	hasSpCertificate: boolean;
	wantAssertionsEncrypted: boolean;
	wantAuthnRequestsSigned: boolean;
	wantLogoutRequestsSigned: boolean;
	/** Last back-channel LogoutRequest delivery outcome (Prompt 36), for the degraded indicator. */
	lastBackchannelLogoutStatus?: string | null;
	lastBackchannelLogoutAt?: string | null;
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

export interface SpConnectionResponseDto {
	item: SpConnectionPublicDto;
}

export interface CreateSpConnectionRequestDto {
	name: string;
	spEntityId: string;
	acsUrl: string;
	sloUrl?: string | null;
	sloSoapUrl?: string | null;
	nameIdFormat?: string;
	attributeMapping?: SpAttributeMappingConfig | null;
	active?: boolean;
	spCertificate?: string | null;
	wantAssertionsEncrypted?: boolean;
	wantAuthnRequestsSigned?: boolean;
	wantLogoutRequestsSigned?: boolean;
}

export interface UpdateSpConnectionRequestDto {
	name?: string;
	spEntityId?: string;
	acsUrl?: string;
	sloUrl?: string | null;
	sloSoapUrl?: string | null;
	nameIdFormat?: string;
	attributeMapping?: SpAttributeMappingConfig | null;
	active?: boolean;
	spCertificate?: string | null;
	wantAssertionsEncrypted?: boolean;
	wantAuthnRequestsSigned?: boolean;
	wantLogoutRequestsSigned?: boolean;
}

export interface ParseSloFromMetadataRequestDto {
	metadataXml: string;
}

export interface ParseSloFromMetadataResponseDto {
	redirect: string | null;
	post: string | null;
	/** SOAP back-channel SLO endpoint, when the metadata advertises it (Prompt 36). */
	soap: string | null;
}

export interface DeleteSpConnectionResponseDto {
	ok: true;
	id: string;
}

export interface SpConnectionTestAcsResponseDto {
	ok: boolean;
	reachable: boolean;
	statusCode?: number;
	message: string;
}

export interface SpConnectionTestSsoUrlResponseDto {
	ssoUrl: string;
	spEntityId: string;
	authnRequestId: string;
	signed: boolean;
	encrypted: boolean;
	warning?: string;
}

export interface ProbeSpSigningRequestDto {
	spPrivateKeyPem: string;
}

export interface ProbeSpSigningResponseDto {
	ok: boolean;
	fingerprintSha256?: string;
	message?: string;
}

export const SAML_NAME_ID_FORMATS = [
	'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
	'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
	'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
	'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
] as const;
