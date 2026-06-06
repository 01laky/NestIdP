// OAuth 2.0 Client Credentials shared types + validation (v1.10.0).

export type OAuthClientAuthMethod = 'client_secret_post' | 'client_secret_basic';

export interface OAuthClientAuthMethodOption {
	id: OAuthClientAuthMethod;
	labelKey: string;
}

export const OAUTH_CLIENT_AUTH_METHODS: readonly OAuthClientAuthMethodOption[] = [
	{ id: 'client_secret_post', labelKey: 'client_secret_post' },
	{ id: 'client_secret_basic', labelKey: 'client_secret_basic' },
];

export const OAUTH_DEFAULT_CLIENT_AUTH_METHOD: OAuthClientAuthMethod = 'client_secret_post';

/** Reserved token-request params the harness controls — operators may not override them. */
export const OAUTH_RESERVED_TOKEN_PARAMS = [
	'grant_type',
	'client_id',
	'client_secret',
	'scope',
	'audience',
] as const;

const MAX_TOKEN_PARAM_ENTRIES = 20;
const MAX_TOKEN_PARAM_LEN = 256;
const MAX_OAUTH_FIELD_LEN = 1024;

export class OAuthConfigValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OAuthConfigValidationError';
	}
}

export function isOAuthClientAuthMethod(value: unknown): value is OAuthClientAuthMethod {
	return value === 'client_secret_post' || value === 'client_secret_basic';
}

/** Validate the optional fixed extra token-request params map (string→string). Throws on error. */
export function assertValidOAuthTokenRequestParams(value: unknown): Record<string, string> | null {
	if (value == null) {
		return null;
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new OAuthConfigValidationError('oauthTokenRequestParams must be an object map');
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_TOKEN_PARAM_ENTRIES) {
		throw new OAuthConfigValidationError(
			`oauthTokenRequestParams: at most ${MAX_TOKEN_PARAM_ENTRIES} entries`,
		);
	}
	const out: Record<string, string> = {};
	for (const [k, v] of entries) {
		if (!k || k.length > MAX_TOKEN_PARAM_LEN) {
			throw new OAuthConfigValidationError(`oauthTokenRequestParams: invalid key "${k}"`);
		}
		if ((OAUTH_RESERVED_TOKEN_PARAMS as readonly string[]).includes(k)) {
			throw new OAuthConfigValidationError(
				`oauthTokenRequestParams: "${k}" is reserved and cannot be overridden`,
			);
		}
		if (typeof v !== 'string' || v.length > MAX_TOKEN_PARAM_LEN) {
			throw new OAuthConfigValidationError(
				`oauthTokenRequestParams["${k}"] must be a string ≤ ${MAX_TOKEN_PARAM_LEN} chars`,
			);
		}
		out[k] = v;
	}
	return out;
}

export interface ValidatedOAuthConfig {
	oauthTokenUrl: string;
	oauthClientId: string;
	oauthScope: string | null;
	oauthAudience: string | null;
	oauthClientAuthMethod: OAuthClientAuthMethod;
	oauthTokenRequestParams: Record<string, string> | null;
}

/**
 * Validate the non-secret OAuth config (token URL, client id, scope, audience, auth method, params).
 * The client secret is validated separately (create requires it; update may keep the existing one).
 */
export function assertValidOAuthConfig(input: {
	oauthTokenUrl?: string | null;
	oauthClientId?: string | null;
	oauthScope?: string | null;
	oauthAudience?: string | null;
	oauthClientAuthMethod?: string | null;
	oauthTokenRequestParams?: unknown;
}): ValidatedOAuthConfig {
	const tokenUrl = (input.oauthTokenUrl ?? '').trim();
	if (!tokenUrl) {
		throw new OAuthConfigValidationError(
			'oauthTokenUrl is required for OAuth 2.0 Client Credentials',
		);
	}
	if (tokenUrl.length > MAX_OAUTH_FIELD_LEN) {
		throw new OAuthConfigValidationError('oauthTokenUrl is too long');
	}
	if (/\s/.test(tokenUrl)) {
		throw new OAuthConfigValidationError('oauthTokenUrl must not contain whitespace');
	}
	const schemeMatch = /^(https?):\/\/([^/?#]*)/i.exec(tokenUrl);
	if (!schemeMatch) {
		throw new OAuthConfigValidationError('oauthTokenUrl must be an absolute http(s) URL');
	}
	const authority = schemeMatch[2];
	if (!authority) {
		throw new OAuthConfigValidationError('oauthTokenUrl must include a host');
	}
	if (authority.includes('@')) {
		throw new OAuthConfigValidationError('oauthTokenUrl must not embed credentials');
	}

	const clientId = (input.oauthClientId ?? '').trim();
	if (!clientId) {
		throw new OAuthConfigValidationError(
			'oauthClientId is required for OAuth 2.0 Client Credentials',
		);
	}
	if (clientId.length > MAX_OAUTH_FIELD_LEN) {
		throw new OAuthConfigValidationError('oauthClientId is too long');
	}

	const scope = input.oauthScope?.trim() ? input.oauthScope.trim() : null;
	if (scope && scope.length > MAX_OAUTH_FIELD_LEN) {
		throw new OAuthConfigValidationError('oauthScope is too long');
	}
	const audience = input.oauthAudience?.trim() ? input.oauthAudience.trim() : null;
	if (audience && audience.length > MAX_OAUTH_FIELD_LEN) {
		throw new OAuthConfigValidationError('oauthAudience is too long');
	}

	const method = input.oauthClientAuthMethod ?? OAUTH_DEFAULT_CLIENT_AUTH_METHOD;
	if (!isOAuthClientAuthMethod(method)) {
		throw new OAuthConfigValidationError(
			`oauthClientAuthMethod must be one of: ${OAUTH_CLIENT_AUTH_METHODS.map((m) => m.id).join(', ')}`,
		);
	}

	const params = assertValidOAuthTokenRequestParams(input.oauthTokenRequestParams);

	return {
		oauthTokenUrl: tokenUrl,
		oauthClientId: clientId,
		oauthScope: scope,
		oauthAudience: audience,
		oauthClientAuthMethod: method,
		oauthTokenRequestParams: params,
	};
}
