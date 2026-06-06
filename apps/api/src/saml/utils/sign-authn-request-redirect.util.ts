import { createSign, createPrivateKey } from 'node:crypto';
import {
	getSamlRedirectSignatureAlgorithm,
	SAML_REDIRECT_SIGNATURE_ALGORITHMS,
} from '@nestidp/shared';
import { buildRedirectBindingSignedContent } from './saml-authn-request-redirect-signature.util';

export interface BuildSignedAuthnRequestRedirectQueryOptions {
	samlRequestRaw: string;
	spPrivateKeyPem: string;
	sigAlgUri?: string;
	relayStateRaw?: string;
}

export interface SignedAuthnRequestRedirectQuery {
	samlRequest: string;
	relayState?: string;
	sigAlg: string;
	signature: string;
}

export function buildSignedAuthnRequestRedirectQuery(
	options: BuildSignedAuthnRequestRedirectQueryOptions,
): SignedAuthnRequestRedirectQuery {
	const sigAlgUri =
		options.sigAlgUri ??
		SAML_REDIRECT_SIGNATURE_ALGORITHMS.find((a) => a.id === 'rsa-sha256')!.xmlSignatureAlgorithm;
	const algorithm = getSamlRedirectSignatureAlgorithm(sigAlgUri);
	if (!algorithm) {
		throw new Error(`Unsupported SigAlg: ${sigAlgUri}`);
	}

	const sigAlgRaw = encodeURIComponent(sigAlgUri);
	const signedContent = buildRedirectBindingSignedContent({
		samlRequestRaw: options.samlRequestRaw,
		relayStateRaw: options.relayStateRaw,
		sigAlgRaw,
	});

	// Node's createSign needs the digest (e.g. 'sha256'); 'ecdsa-with-SHA256' is rejected.
	const digestMatch = algorithm.nodeVerifyAlgorithm.match(/sha-?(\d+)/i);
	const digest = digestMatch ? `sha${digestMatch[1]}` : 'sha256';
	const signer = createSign(digest);
	const privateKey = createPrivateKey({ key: options.spPrivateKeyPem, format: 'pem' });
	const signature = signer.update(signedContent, 'utf8').sign(privateKey, 'base64');

	return {
		samlRequest: options.samlRequestRaw,
		relayState: options.relayStateRaw,
		sigAlg: sigAlgRaw,
		signature: encodeURIComponent(signature),
	};
}
