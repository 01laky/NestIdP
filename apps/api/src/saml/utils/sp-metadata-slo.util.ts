import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import {
	POST_BINDING_URI,
	REDIRECT_BINDING_URI,
	SOAP_BINDING_URI,
	type ParseSloFromMetadataResponseDto,
} from '@nestidp/shared';

const select = xpath.useNamespaces({
	md: 'urn:oasis:names:tc:SAML:2.0:metadata',
});

/**
 * Extract `md:SingleLogoutService` Locations (by binding) from a pasted SP
 * EntityDescriptor. Returns null fields when the metadata has no SLO endpoint.
 */
export function extractSloUrlFromSpMetadata(xml: string): ParseSloFromMetadataResponseDto {
	const empty: ParseSloFromMetadataResponseDto = { redirect: null, post: null, soap: null };
	if (!xml || xml.trim().length === 0) {
		return empty;
	}
	let doc: ReturnType<DOMParser['parseFromString']>;
	try {
		doc = new DOMParser().parseFromString(xml, 'text/xml');
	} catch {
		return empty;
	}
	const parseError = (doc as { parseError?: { errorCode: number } }).parseError;
	if (parseError && parseError.errorCode !== 0) {
		return empty;
	}

	const nodes = select(
		'//md:SPSSODescriptor/md:SingleLogoutService',
		doc as unknown as Node,
	) as Node[];
	let redirect: string | null = null;
	let post: string | null = null;
	let soap: string | null = null;
	for (const node of nodes) {
		const el = node as Element;
		const binding = el.getAttribute('Binding');
		const location = el.getAttribute('Location');
		if (!location) {
			continue;
		}
		if (binding === REDIRECT_BINDING_URI && !redirect) {
			redirect = location;
		} else if (binding === POST_BINDING_URI && !post) {
			post = location;
		} else if (binding === SOAP_BINDING_URI && !soap) {
			soap = location;
		}
	}
	return { redirect, post, soap };
}
