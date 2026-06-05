import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import type { ParseRedirectBindingResult, ParsedAuthnRequestDto } from '@nestidp/shared';
import { decodeRedirectBinding } from '../utils/build-authn-request.util';
import { getExpectedSsoDestination, normalizeUrlForComparison } from '../utils/saml-url.util';
import {
	decryptXmlEncryptedElement,
	isEncryptedDataRoot,
	SamlXmlDecryptionError,
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

		let doc: ReturnType<DOMParser['parseFromString']>;
		try {
			doc = new DOMParser().parseFromString(decoded, 'text/xml');
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
		};

		return { authnRequest, relayState, requestWasEncrypted };
	}

	private async decryptEncryptedRequest(encryptedXml: string): Promise<string> {
		if (await this.idpEncryptionKey.hasEcEncryptionKey()) {
			throw new BadRequestException('Encrypted SAMLRequest not supported with EC IdP encryption key');
		}

		const materials = await this.idpEncryptionKey.getDecryptionMaterial();
		if (materials.length === 0) {
			throw new BadRequestException('IdP encryption certificate is not configured');
		}

		let lastError: unknown;
		for (const material of materials) {
			try {
				return decryptXmlEncryptedElement(encryptedXml, material.privateKeyPem, {
					keyTransportAlgorithmId: material.keyTransportAlgorithmId,
				});
			} catch (error) {
				lastError = error;
			}
		}

		if (lastError instanceof SamlXmlDecryptionError) {
			throw new BadRequestException('Failed to decrypt SAMLRequest');
		}
		throw new BadRequestException('Failed to decrypt SAMLRequest');
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
