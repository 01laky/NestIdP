import { createVerify, type KeyObject } from 'node:crypto';
import { createPublicKey } from 'node:crypto';
import {
	getSamlRedirectSignatureAlgorithm,
	RELAY_STATE_QUERY_PARAM,
	SAML_REQUEST_QUERY_PARAM,
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

	const signatureDecoded = Buffer.from(decodeURIComponent(options.signatureBase64UrlEncoded), 'base64');
	const verifier = createVerify(algorithm.nodeVerifyAlgorithm);
	verifier.update(options.signedContent, 'utf8');
	verifier.end();
	return verifier.verify(publicKey, signatureDecoded);
}
