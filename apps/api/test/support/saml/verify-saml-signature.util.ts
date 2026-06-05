import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as xpath from 'xpath';
import { applyNestIdpXmlCryptoExtensions } from '@api/saml/xml-crypto-extended-algorithms';

/** Returns true when xml-crypto validates the XML signature with the given cert PEM. */
export function verifySamlXmlSignature(signedXml: string, certPem: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
		const signatureNode = xpath.select1("//*[local-name(.)='Signature']", doc as unknown as Node);
		if (!signatureNode || typeof signatureNode !== 'object') {
			return false;
		}
		const sig = new SignedXml({ publicCert: certPem });
		applyNestIdpXmlCryptoExtensions(sig);
		sig.loadSignature(signatureNode as Node);
		return sig.checkSignature(signedXml);
	} catch {
		return false;
	}
}

/** Extract base64 SAMLResponse value from auto-post HTML. */
export function extractSamlResponseFromHtml(html: string): string | null {
	const match = html.match(/name="SAMLResponse"\s+value="([^"]+)"/);
	return match?.[1] ?? null;
}

export function decodeSamlResponseBase64(base64: string): string {
	return Buffer.from(base64, 'base64').toString('utf8');
}
