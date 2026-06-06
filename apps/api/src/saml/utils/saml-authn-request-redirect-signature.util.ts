import { createSign, createVerify, type KeyObject } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { createPublicKey } from 'node:crypto';
import {
	getSamlRedirectSignatureAlgorithm,
	RELAY_STATE_QUERY_PARAM,
	SAML_REQUEST_QUERY_PARAM,
	SAML_RESPONSE_POST_FIELD,
	SIG_ALG_QUERY_PARAM,
	SIGNATURE_QUERY_PARAM,
} from '@nestidp/shared';

export class SamlAuthnRequestSignatureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SamlAuthnRequestSignatureError';
	}
}

export interface RawSamlRedirectQueryParams {
	samlRequest?: string;
	relayState?: string;
	sigAlg?: string;
	signature?: string;
}

/**
 * Node's `createSign`/`createVerify` require the digest name (e.g. `sha256`), not the
 * OpenSSL algorithm name. `RSA-SHA256` happens to be accepted for RSA, but
 * `ecdsa-with-SHA256` throws `Invalid digest`. Using the bare digest works for both RSA
 * and EC keys (Node infers RSA-vs-ECDSA from the key type), so derive it from the
 * catalog's `nodeVerifyAlgorithm` for universal signing/verification.
 */
function digestForRedirectAlgorithm(nodeVerifyAlgorithm: string): string {
	const match = nodeVerifyAlgorithm.match(/sha-?(\d+)/i);
	return match ? `sha${match[1]}` : 'sha256';
}

export function extractRawQueryStringFromRequestUrl(url: string): string {
	const queryIndex = url.indexOf('?');
	if (queryIndex === -1) {
		return '';
	}
	return url.slice(queryIndex + 1);
}

export function parseRawSamlRedirectQuery(rawQuery: string): RawSamlRedirectQueryParams {
	const params: RawSamlRedirectQueryParams = {};
	if (!rawQuery) {
		return params;
	}

	for (const segment of rawQuery.split('&')) {
		if (!segment) {
			continue;
		}
		const eq = segment.indexOf('=');
		if (eq === -1) {
			continue;
		}
		const name = segment.slice(0, eq);
		const value = segment.slice(eq + 1);
		if (name === SAML_REQUEST_QUERY_PARAM) {
			params.samlRequest = value;
		} else if (name === RELAY_STATE_QUERY_PARAM) {
			params.relayState = value;
		} else if (name === SIG_ALG_QUERY_PARAM) {
			params.sigAlg = value;
		} else if (name === SIGNATURE_QUERY_PARAM) {
			params.signature = value;
		}
	}

	return params;
}

export function buildRedirectBindingSignedContent(params: {
	samlRequestRaw: string;
	relayStateRaw?: string;
	sigAlgRaw: string;
}): string {
	const parts = [`${SAML_REQUEST_QUERY_PARAM}=${params.samlRequestRaw}`];
	if (params.relayStateRaw && params.relayStateRaw.length > 0) {
		parts.push(`${RELAY_STATE_QUERY_PARAM}=${params.relayStateRaw}`);
	}
	parts.push(`${SIG_ALG_QUERY_PARAM}=${params.sigAlgRaw}`);
	return parts.join('&');
}

/**
 * Build a signed HTTP-Redirect binding query for an outbound `SAMLResponse`
 * (e.g. a LogoutResponse). The response XML is DEFLATE-compressed, base64- and
 * URL-encoded, the octet string `SAMLResponse=...&RelayState=...&SigAlg=...` is
 * signed with the IdP private key, and `Signature=...` is appended.
 *
 * Returns the full query string (no leading `?`). The signed content is keyed to
 * `SAMLResponse` (NOT `SAMLRequest`).
 */
export function buildSignedRedirectBindingResponse(options: {
	responseXml: string;
	relayState?: string | null;
	sigAlgUri: string;
	privateKeyPem: string;
}): string {
	const algorithm = getSamlRedirectSignatureAlgorithm(options.sigAlgUri);
	if (!algorithm) {
		throw new SamlAuthnRequestSignatureError(
			`Unsupported redirect signature algorithm: ${options.sigAlgUri}`,
		);
	}

	const deflated = deflateRawSync(Buffer.from(options.responseXml, 'utf8')).toString('base64');
	const samlResponseRaw = encodeURIComponent(deflated);
	const relayStateRaw =
		options.relayState != null && options.relayState.length > 0
			? encodeURIComponent(options.relayState)
			: undefined;
	const sigAlgRaw = encodeURIComponent(options.sigAlgUri);

	const parts = [`${SAML_RESPONSE_POST_FIELD}=${samlResponseRaw}`];
	if (relayStateRaw) {
		parts.push(`${RELAY_STATE_QUERY_PARAM}=${relayStateRaw}`);
	}
	parts.push(`${SIG_ALG_QUERY_PARAM}=${sigAlgRaw}`);
	const signedContent = parts.join('&');

	const signer = createSign(digestForRedirectAlgorithm(algorithm.nodeVerifyAlgorithm));
	signer.update(signedContent, 'utf8');
	signer.end();
	const signature = signer.sign(options.privateKeyPem).toString('base64');

	return `${signedContent}&${SIGNATURE_QUERY_PARAM}=${encodeURIComponent(signature)}`;
}

export function verifyRedirectBindingSignature(options: {
	signedContent: string;
	signatureBase64UrlEncoded: string;
	sigAlgUri: string;
	certificatePem: string;
}): boolean {
	const algorithm = getSamlRedirectSignatureAlgorithm(options.sigAlgUri);
	if (!algorithm) {
		return false;
	}

	let publicKey: KeyObject;
	try {
		publicKey = createPublicKey({ key: options.certificatePem, format: 'pem' });
	} catch {
		return false;
	}

	const signatureDecoded = Buffer.from(
		decodeURIComponent(options.signatureBase64UrlEncoded),
		'base64',
	);
	const verifier = createVerify(digestForRedirectAlgorithm(algorithm.nodeVerifyAlgorithm));
	verifier.update(options.signedContent, 'utf8');
	verifier.end();
	return verifier.verify(publicKey, signatureDecoded);
}
