import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { SignedXml } from 'xml-crypto';

/**
 * Verify an enveloped XML-DSig `<ds:Signature>` that is a child of the document
 * root element (e.g. `<samlp:AuthnRequest>` or `<samlp:LogoutRequest>`), using the
 * provided certificate PEM. Root-element-agnostic: it selects the first `Signature`
 * node by local-name. Returns false on any parse/verify error (never throws).
 */
export function verifyEnvelopedXmlDsig(xml: string, certPem: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const sigNodes = xpath.select(
			"//*[local-name(.)='Signature']",
			doc as unknown as Node,
		) as Node[];
		if (!sigNodes.length) {
			return false;
		}
		const signed = new SignedXml({ publicCert: certPem });
		signed.loadSignature(sigNodes[0] as Element);
		return signed.checkSignature(xml);
	} catch {
		return false;
	}
}

/** True when the XML carries an enveloped `<ds:Signature>` anywhere. */
export function hasEnvelopedSignature(xml: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const sigNodes = xpath.select(
			"//*[local-name(.)='Signature']",
			doc as unknown as Node,
		) as Node[];
		return sigNodes.length > 0;
	} catch {
		return false;
	}
}
