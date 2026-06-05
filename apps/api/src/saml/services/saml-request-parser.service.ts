import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import type { ParseRedirectBindingResult, ParsedAuthnRequestDto } from '@nestidp/shared';
import { decodeRedirectBinding } from '../utils/build-authn-request.util';
import { getExpectedSsoDestination, normalizeUrlForComparison } from '../utils/saml-url.util';
import {
	decryptXmlEcdhEs,
	decryptXmlEncryptedElement,
	isEcdhEsAgreement,
	isEncryptedDataRoot,
} from '../utils/saml-xml-decryption.util';
import { IdpEncryptionKeyService } from './idp-encryption-key.service';

const MAX_SAML_REQUEST_BYTES = 256 * 1024;

export interface ParseRedirectBindingOptions {
	requestWasEncrypted?: boolean;
}

@Injectable()
export class SamlRequestParserService {
	constructor(
		private readonly configService: ConfigService,
		private readonly idpEncryptionKey: IdpEncryptionKeyService,
	) {}

	async parseRedirectBinding(
		encodedRequest: string,
		relayState?: string,
	): Promise<ParseRedirectBindingResult & ParseRedirectBindingOptions> {
		if (!encodedRequest || encodedRequest.trim().length === 0) {
			throw new BadRequestException('Missing SAMLRequest');
		}

		let decoded: string;
		try {
			const urlDecoded = decodeURIComponent(encodedRequest);
			decoded = decodeRedirectBinding(urlDecoded);
		} catch {
			throw new BadRequestException('Invalid SAMLRequest encoding');
		}

		let requestWasEncrypted = false;
		if (isEncryptedDataRoot(decoded)) {
			decoded = await this.decryptEncryptedRequest(decoded);
			requestWasEncrypted = true;
		}

		if (Buffer.byteLength(decoded, 'utf8') > MAX_SAML_REQUEST_BYTES) {
			throw new BadRequestException('SAMLRequest too large');
		}

		const parsed = this.parseAuthnRequestXml(decoded, relayState, 'redirect');
		return { authnRequest: parsed.authnRequest, relayState: parsed.relayState, requestWasEncrypted };
	}

	async parsePostBinding(
		encodedRequest: string,
		relayState?: string,
	): Promise<ParseRedirectBindingResult & { requestWasEncrypted: boolean; requestWasSigned: boolean; rawAuthnRequestXml: string }> {
		if (!encodedRequest?.trim()) {
			throw new BadRequestException('Missing SAMLRequest');
		}

		let decoded: string;
		try {
			decoded = Buffer.from(encodedRequest, 'base64').toString('utf8');
		} catch {
			throw new BadRequestException('Invalid SAMLRequest encoding');
		}

		// Reject deflate-encoded payloads (binary garbage — first byte < 0x20 and not whitespace)
		if (decoded.length > 0 && decoded.charCodeAt(0) < 0x20 && decoded.charCodeAt(0) !== 0x09 && decoded.charCodeAt(0) !== 0x0a && decoded.charCodeAt(0) !== 0x0d) {
			throw new BadRequestException('Invalid SAMLRequest encoding — deflate-encoded data is not accepted for POST binding');
		}

		if (Buffer.byteLength(decoded, 'utf8') > MAX_SAML_REQUEST_BYTES) {
			throw new BadRequestException('SAMLRequest too large');
		}

		let requestWasEncrypted = false;
		if (isEncryptedDataRoot(decoded)) {
			decoded = await this.decryptEncryptedRequest(decoded);
			requestWasEncrypted = true;
		}

		const parsed = this.parseAuthnRequestXml(decoded, relayState, 'post');

		// Detect enveloped ds:Signature
		const selectPost = xpath.useNamespaces({
			samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
			saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
			ds: 'http://www.w3.org/2000/09/xmldsig#',
		});
		const doc = new DOMParser().parseFromString(decoded, 'text/xml');
		const sigNodes = selectPost('//samlp:AuthnRequest/ds:Signature', doc as unknown as Node) as Node[];
		const requestWasSigned = sigNodes.length > 0;

		return {
			authnRequest: parsed.authnRequest,
			relayState: parsed.relayState,
			requestWasEncrypted,
			requestWasSigned,
			rawAuthnRequestXml: decoded,
		};
	}

	private parseAuthnRequestXml(
		xml: string,
		relayState: string | undefined,
		bindingType: 'redirect' | 'post',
	): ParseRedirectBindingResult {
		let doc: ReturnType<DOMParser['parseFromString']>;
		try {
			doc = new DOMParser().parseFromString(xml, 'text/xml');
		} catch {
			throw new BadRequestException('Invalid SAMLRequest XML');
		}
		const parseError = (doc as { parseError?: { errorCode: number } }).parseError;
		if (parseError && parseError.errorCode !== 0) {
			throw new BadRequestException('Invalid SAMLRequest XML');
		}
		const select = xpath.useNamespaces({
			samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
			saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
		});

		const authnNodes = select('//samlp:AuthnRequest', doc as unknown as Node) as Node[];
		if (!authnNodes.length) {
			throw new BadRequestException('Invalid SAMLRequest root element');
		}

		const authn = authnNodes[0] as Element;
		const id = authn.getAttribute('ID');
		const issueInstant = authn.getAttribute('IssueInstant');
		const destination = authn.getAttribute('Destination') ?? undefined;
		const protocolBinding = authn.getAttribute('ProtocolBinding') ?? undefined;

		if (!id || id.length > 256) {
			throw new BadRequestException('Invalid AuthnRequest ID');
		}

		const issuer = this.extractIssuer(select, authn);
		if (!issuer) {
			throw new BadRequestException('Missing Issuer');
		}

		if (!issueInstant || Number.isNaN(Date.parse(issueInstant))) {
			throw new BadRequestException('Invalid IssueInstant');
		}

		this.validateIssueInstant(issueInstant);

		if (destination) {
			const expected = getExpectedSsoDestination(
				this.configService.get<string>('IDP_BASE_URL') ?? '',
			);
			if (normalizeUrlForComparison(destination) !== expected) {
				throw new BadRequestException('Invalid Destination');
			}
		}

		const authnRequest: ParsedAuthnRequestDto = {
			id,
			issuer,
			destination,
			issueInstant,
			protocolBinding,
			bindingType,
		};

		return { authnRequest, relayState };
	}

	private async decryptEncryptedRequest(encryptedXml: string): Promise<string> {
		const isEc = isEcdhEsAgreement(encryptedXml);

		if (isEc) {
			const ecMaterials = await this.idpEncryptionKey.getEcDecryptionMaterial();
			if (ecMaterials.length === 0) {
				const rsaMaterials = await this.idpEncryptionKey.getRsaDecryptionMaterial();
				if (rsaMaterials.length > 0) {
					throw new BadRequestException(
						'EC key agreement payload received but IdP has RSA encryption key',
					);
				}
				throw new BadRequestException('IdP encryption certificate is not configured');
			}
			for (const mat of ecMaterials) {
				try {
					return decryptXmlEcdhEs(encryptedXml, mat.privateKeyPem, mat.ecCurve);
				} catch {
					// try next key
				}
			}
			throw new BadRequestException('Failed to decrypt EC-encrypted SAMLRequest');
		} else {
			const rsaMaterials = await this.idpEncryptionKey.getRsaDecryptionMaterial();
			if (rsaMaterials.length === 0) {
				const ecMaterials = await this.idpEncryptionKey.getEcDecryptionMaterial();
				if (ecMaterials.length > 0) {
					throw new BadRequestException(
						'RSA key transport payload received but IdP has EC encryption key',
					);
				}
				throw new BadRequestException('IdP encryption certificate is not configured');
			}
			for (const mat of rsaMaterials) {
				try {
					return decryptXmlEncryptedElement(encryptedXml, mat.privateKeyPem, {
						keyTransportAlgorithmId: mat.keyTransportAlgorithmId,
					});
				} catch {
					// try next key
				}
			}
			throw new BadRequestException('Failed to decrypt SAMLRequest');
		}
	}

	private extractIssuer(select: xpath.XPathSelect, authn: Element): string | null {
		const child = select('saml:Issuer', authn) as Node[];
		if (child.length > 0) {
			return (child[0].textContent ?? '').trim() || null;
		}
		const attr = authn.getAttribute('Issuer');
		return attr?.trim() || null;
	}

	private validateIssueInstant(issueInstant: string): void {
		const skewSeconds = this.getClockSkewSeconds();
		const instantMs = Date.parse(issueInstant);
		const now = Date.now();
		const skewMs = skewSeconds * 1000;
		if (instantMs > now + skewMs) {
			throw new BadRequestException('IssueInstant is in the future');
		}
		if (instantMs < now - skewMs) {
			throw new BadRequestException('IssueInstant is too old');
		}
	}

	private getClockSkewSeconds(): number {
		const raw = this.configService.get<number | string>('SAML_CLOCK_SKEW_SECONDS');
		if (raw == null || raw === '') {
			return 120;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
	}
}
