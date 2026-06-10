import { Injectable, Logger } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { SAML_STATUS_PARTIAL_LOGOUT, SAML_STATUS_SUCCESS } from '@nestidp/shared';
import { redactSecrets } from '../../encryption/utils/redact-secret.util';
import { errorMessage as messageOf } from '../../common/utils/error-message.util';
import { verifyEnvelopedXmlDsig } from '../utils/saml-enveloped-signature.util';

export type SoapDeliveryOutcome = 'succeeded' | 'partial' | 'failed';

export interface SoapDeliveryResult {
	outcome: SoapDeliveryOutcome;
	reason?: string;
}

export interface SoapDeliveryInput {
	soapUrl: string;
	signedLogoutRequestXml: string;
	requestId: string;
	/** SP signing cert (PEM) to verify the LogoutResponse signature, when configured. */
	spCertificate?: string | null;
	timeoutMs: number;
	/** Allowed clock skew (seconds) when checking response timestamps. */
	clockSkewSeconds: number;
}

const select = xpath.useNamespaces({
	soap: 'http://schemas.xmlsoap.org/soap/envelope/',
	samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
	saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
});

/**
 * Posts a signed `<samlp:LogoutRequest>` wrapped in a SOAP 1.1 envelope to an SP's SOAP SLO endpoint and
 * interprets the LogoutResponse (Prompt 36). Pure transport + verification — never throws; every error
 * path returns `{ outcome: 'failed', reason }`. No request/response bodies are logged.
 */
@Injectable()
export class SamlSoapBackchannelService {
	private readonly logger = new Logger('SamlSoapBackchannel');

	async deliver(input: SoapDeliveryInput): Promise<SoapDeliveryResult> {
		if (!/^https:/i.test(input.soapUrl)) {
			this.logger.warn(
				JSON.stringify({
					event: 'backchannel_logout_insecure_endpoint',
					requestId: input.requestId,
				}),
			);
		}
		const envelope = wrapSoap(input.signedLogoutRequestXml);

		let body: string;
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), input.timeoutMs);
			try {
				const res = await fetch(input.soapUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'text/xml; charset=utf-8',
						SOAPAction: '""',
					},
					body: envelope,
					signal: controller.signal,
				});
				if (!res.ok) {
					return { outcome: 'failed', reason: `http_${res.status}` };
				}
				body = await res.text();
			} finally {
				clearTimeout(timer);
			}
		} catch (error) {
			const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network';
			return { outcome: 'failed', reason: `${reason}:${redactSecrets(messageOf(error))}` };
		}

		return this.interpretResponse(body, input);
	}

	private interpretResponse(body: string, input: SoapDeliveryInput): SoapDeliveryResult {
		let doc: ReturnType<DOMParser['parseFromString']>;
		try {
			doc = new DOMParser().parseFromString(body, 'text/xml');
		} catch {
			return { outcome: 'failed', reason: 'response_malformed' };
		}
		const responseNodes = select('//samlp:LogoutResponse', doc as unknown as Node) as Element[];
		if (!responseNodes.length) {
			return { outcome: 'failed', reason: 'no_logout_response' };
		}
		// A legitimate SOAP LogoutResponse carries exactly one <LogoutResponse>. Reject extras outright so a
		// signature-wrapping payload (a second, attacker-controlled response) can't flip the read status.
		if (responseNodes.length > 1) {
			return { outcome: 'failed', reason: 'multiple_logout_responses' };
		}
		const root = responseNodes[0];

		// We always send the SOAP LogoutRequest with an ID, so a response without InResponseTo cannot be
		// correlated to our request — treat it as a failure rather than accepting it blindly (§5.C).
		const inResponseTo = root.getAttribute('InResponseTo');
		if (!inResponseTo) {
			return { outcome: 'failed', reason: 'missing_in_response_to' };
		}
		if (inResponseTo !== input.requestId) {
			return { outcome: 'failed', reason: 'in_response_to_mismatch' };
		}

		// Verify the SP's signature against the ORIGINAL received bytes, not a re-serialised node — a
		// round-tripped `root.toString()` re-emits namespaces/whitespace and breaks XML-DSig canonicalisation.
		// Conditional by design: an SP without a registered certificate cannot be verified at all.
		if (input.spCertificate) {
			let verified = false;
			try {
				verified = verifyEnvelopedXmlDsig(body, input.spCertificate);
			} catch {
				verified = false;
			}
			if (!verified) {
				return { outcome: 'failed', reason: 'response_signature_invalid' };
			}
		}

		// Scope the status read to the (single, verified) response element rather than the whole document.
		const statusNodes = select('./samlp:Status/samlp:StatusCode/@Value', root) as Attr[];
		const topStatus = statusNodes[0]?.value ?? '';
		if (topStatus === SAML_STATUS_SUCCESS) {
			return { outcome: 'succeeded' };
		}
		// PartialLogout can appear nested as a second StatusCode.
		const allStatuses = statusNodes.map((n) => n.value);
		if (allStatuses.includes(SAML_STATUS_PARTIAL_LOGOUT)) {
			return { outcome: 'partial', reason: 'partial_logout' };
		}
		return { outcome: 'failed', reason: `status:${topStatus || 'unknown'}` };
	}
}

function wrapSoap(logoutRequestXml: string): string {
	const stripped = logoutRequestXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
	return (
		`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
		`<soap:Body>${stripped}</soap:Body></soap:Envelope>`
	);
}
