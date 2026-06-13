import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import {
	POST_BINDING_URI,
	REDIRECT_BINDING_URI,
	SOAP_BINDING_URI,
	type ParseSloFromMetadataResponseDto,
	type SpMetadataAcsOption,
} from '@nestidp/shared';

const SAML_MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';

const select = xpath.useNamespaces({ md: SAML_MD_NS, ds: DS_NS });

/** Defensive cap so a hostile document can never blow up the parser before the DTO limit applies. */
const MAX_METADATA_BYTES = 512 * 1024;

/**
 * Structured, dependency-free result of parsing an SP `EntityDescriptor`. Certificates are returned
 * as normalized PEM strings but are NOT X509-validated here — the service layer validates them (so
 * this util stays pure and free of node:crypto). `valid` is false when no `SPSSODescriptor` is found.
 */
export interface SpMetadataParseResult {
	valid: boolean;
	entityId: string | null;
	acs: SpMetadataAcsOption[];
	slo: ParseSloFromMetadataResponseDto;
	nameIdFormats: string[];
	/** Raw signing-certificate PEMs (base64 DER bodies wrapped to PEM), in document order. */
	signingCertificates: string[];
	authnRequestsSigned: boolean;
	wantAssertionsSigned: boolean;
	/** Whether a `ds:Signature` was present on the document (informational; not verified). */
	signed: boolean;
	/** `validUntil` attribute (ISO string) when present, else null. */
	validUntil: string | null;
	/** Number of `md:EntityDescriptor` elements in the document (for the multiple-entities warning). */
	entityCount: number;
}

function emptyResult(): SpMetadataParseResult {
	return {
		valid: false,
		entityId: null,
		acs: [],
		slo: { redirect: null, post: null, soap: null },
		nameIdFormats: [],
		signingCertificates: [],
		authnRequestsSigned: false,
		wantAssertionsSigned: false,
		signed: false,
		validUntil: null,
		entityCount: 0,
	};
}

function parseBoolAttr(value: string | null): boolean {
	return value === 'true' || value === '1';
}

function base64BodyToPem(raw: string): string | null {
	// Strip any stray PEM armor + whitespace, then re-wrap the base64 DER body as a single PEM block.
	const body = raw
		.replace(/-----BEGIN CERTIFICATE-----/g, '')
		.replace(/-----END CERTIFICATE-----/g, '')
		.replace(/\s+/g, '');
	if (body.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(body)) {
		return null;
	}
	const lines = body.match(/.{1,64}/g) ?? [body];
	return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

/**
 * Parse an SP `EntityDescriptor` (or the SP entity inside an `EntitiesDescriptor`) into a structured
 * result. Hardened against XML abuse: a document declaring a DOCTYPE is rejected outright (defends
 * against entity-expansion / XXE — `@xmldom/xmldom` does not resolve external entities, but a DOCTYPE
 * is never legitimate in SAML metadata), oversized input is rejected, and malformed XML never throws.
 */
export function extractSpMetadata(xml: string): SpMetadataParseResult {
	if (!xml || xml.trim().length === 0) {
		return emptyResult();
	}
	if (xml.length > MAX_METADATA_BYTES) {
		return emptyResult();
	}
	// Reject any DOCTYPE declaration before parsing (no legitimate SAML metadata carries one).
	if (/<!DOCTYPE/i.test(xml)) {
		return emptyResult();
	}

	let doc: ReturnType<DOMParser['parseFromString']>;
	try {
		// Swallow parser diagnostics; a malformed document yields an empty result, never a throw.
		doc = new DOMParser({
			onError: () => {
				/* ignore */
			},
		}).parseFromString(xml, 'text/xml');
	} catch {
		return emptyResult();
	}
	const parseError = (doc as { parseError?: { errorCode: number } }).parseError;
	if (parseError && parseError.errorCode !== 0) {
		return emptyResult();
	}

	let entityDescriptors: Element[];
	try {
		entityDescriptors = select('//md:EntityDescriptor', doc as unknown as Node) as Element[];
	} catch {
		return emptyResult();
	}
	if (entityDescriptors.length === 0) {
		return emptyResult();
	}

	// Pick the first EntityDescriptor that actually carries an SPSSODescriptor.
	let entity: Element | null = null;
	let spsso: Element | null = null;
	for (const ed of entityDescriptors) {
		const found = select('./md:SPSSODescriptor', ed as unknown as Node) as Element[];
		if (found.length > 0) {
			entity = ed;
			spsso = found[0];
			break;
		}
	}
	if (!entity || !spsso) {
		return emptyResult();
	}

	const result = emptyResult();
	result.valid = true;
	result.entityCount = entityDescriptors.length;
	result.entityId = entity.getAttribute('entityID') || null;
	result.validUntil =
		entity.getAttribute('validUntil') ||
		(select('//md:EntitiesDescriptor', doc as unknown as Node) as Element[])[0]?.getAttribute(
			'validUntil',
		) ||
		null;
	result.authnRequestsSigned = parseBoolAttr(spsso.getAttribute('AuthnRequestsSigned'));
	result.wantAssertionsSigned = parseBoolAttr(spsso.getAttribute('WantAssertionsSigned'));
	result.signed =
		(select('./ds:Signature', entity as unknown as Node) as Element[]).length > 0 ||
		(select('//md:EntitiesDescriptor/ds:Signature', doc as unknown as Node) as Element[]).length >
			0;

	// ACS endpoints.
	const acsNodes = select('./md:AssertionConsumerService', spsso as unknown as Node) as Element[];
	for (const node of acsNodes) {
		const binding = node.getAttribute('Binding');
		const location = node.getAttribute('Location');
		if (!binding || !location) {
			continue;
		}
		const rawIndex = node.getAttribute('index');
		const index = rawIndex != null && /^\d+$/.test(rawIndex) ? Number.parseInt(rawIndex, 10) : null;
		result.acs.push({
			binding,
			location,
			index,
			isDefault: parseBoolAttr(node.getAttribute('isDefault')),
		});
	}

	// SLO endpoints (by binding) — same shape the legacy SLO-only parser returned.
	const sloNodes = select('./md:SingleLogoutService', spsso as unknown as Node) as Element[];
	for (const node of sloNodes) {
		const binding = node.getAttribute('Binding');
		const location = node.getAttribute('Location');
		if (!location) {
			continue;
		}
		if (binding === REDIRECT_BINDING_URI && !result.slo.redirect) {
			result.slo.redirect = location;
		} else if (binding === POST_BINDING_URI && !result.slo.post) {
			result.slo.post = location;
		} else if (binding === SOAP_BINDING_URI && !result.slo.soap) {
			result.slo.soap = location;
		}
	}

	// NameID formats (document order).
	const nameIdNodes = select('./md:NameIDFormat/text()', spsso as unknown as Node) as Node[];
	for (const node of nameIdNodes) {
		const value = node.nodeValue?.trim();
		if (value) {
			result.nameIdFormats.push(value);
		}
	}

	// Signing certificates: KeyDescriptor with use="signing" or no use (= both); never use="encryption".
	const keyDescriptors = select('./md:KeyDescriptor', spsso as unknown as Node) as Element[];
	for (const kd of keyDescriptors) {
		const use = kd.getAttribute('use');
		if (use && use !== 'signing') {
			continue;
		}
		const certNodes = select(
			'./ds:KeyInfo/ds:X509Data/ds:X509Certificate/text()',
			kd as unknown as Node,
		) as Node[];
		for (const certNode of certNodes) {
			const pem = base64BodyToPem(certNode.nodeValue ?? '');
			if (pem) {
				result.signingCertificates.push(pem);
			}
		}
	}

	return result;
}

/**
 * Backwards-compatible SLO-only extraction (v0.7.0 contract): `{ redirect, post, soap }`. Now delegates
 * to {@link extractSpMetadata} so there is a single source of truth for SP-metadata parsing.
 */
export function extractSloUrlFromSpMetadata(xml: string): ParseSloFromMetadataResponseDto {
	return extractSpMetadata(xml).slo;
}
