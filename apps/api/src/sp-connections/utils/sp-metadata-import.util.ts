import {
	isSamlNameIdFormat,
	POST_BINDING_URI,
	type SpMetadataAcsOption,
	type SpMetadataEntityConflictDto,
	type SpMetadataImportResponseDto,
	type SpMetadataWarning,
} from '@nestidp/shared';
import type { SpMetadataParseResult } from '../../saml/utils/sp-metadata.util';
import { assertValidSpCertificatePem } from './sp-certificate.util';

/** Order ACS endpoints by: isDefault first, then lowest index (absent index last), then document order. */
function pickAcs(candidates: SpMetadataAcsOption[]): SpMetadataAcsOption | null {
	if (candidates.length === 0) {
		return null;
	}
	const sorted = candidates
		.map((option, order) => ({ option, order }))
		.sort((a, b) => {
			if (a.option.isDefault !== b.option.isDefault) {
				return a.option.isDefault ? -1 : 1;
			}
			const ai = a.option.index ?? Number.POSITIVE_INFINITY;
			const bi = b.option.index ?? Number.POSITIVE_INFINITY;
			if (ai !== bi) {
				return ai - bi;
			}
			return a.order - b.order;
		});
	return sorted[0].option;
}

/**
 * Turn a raw {@link SpMetadataParseResult} into the operator-facing prefill DTO (Prompt 42): choose the
 * ACS (HTTP-POST preferred), NameID format, and signing certificate, and collect non-fatal warnings.
 * Pure (no DB / no network); the entityID conflict is supplied by the caller.
 */
export function buildSpMetadataImportResult(
	parsed: SpMetadataParseResult,
	options: { now: Date; entityIdConflict: SpMetadataEntityConflictDto | null },
): SpMetadataImportResponseDto {
	if (!parsed.valid) {
		return {
			valid: false,
			entityId: null,
			acsUrl: null,
			acsOptions: [],
			sloUrl: null,
			sloSoapUrl: null,
			nameIdFormat: null,
			spCertificate: null,
			signingCertificates: [],
			authnRequestsSigned: false,
			wantAssertionsSigned: false,
			signed: parsed.signed,
			warnings: [],
			entityIdConflict: null,
		};
	}

	const warnings: SpMetadataWarning[] = [];

	// --- ACS: prefer HTTP-POST (the IdP delivers the assertion via POST) ---
	const postAcs = parsed.acs.filter((a) => a.binding === POST_BINDING_URI);
	let chosenAcs: SpMetadataAcsOption | null;
	if (postAcs.length > 0) {
		chosenAcs = pickAcs(postAcs);
	} else if (parsed.acs.length > 0) {
		chosenAcs = pickAcs(parsed.acs);
		warnings.push({ code: 'acs_non_post_only' });
	} else {
		chosenAcs = null;
		warnings.push({ code: 'no_acs' });
	}

	// --- NameID format: first supported one ---
	let nameIdFormat: string | null = null;
	const supported = parsed.nameIdFormats.find((f) => isSamlNameIdFormat(f));
	if (supported) {
		nameIdFormat = supported;
	} else if (parsed.nameIdFormats.length > 0) {
		warnings.push({ code: 'unsupported_nameid_format', detail: parsed.nameIdFormats[0] });
	}

	// --- Signing certificates: keep only X509-valid ones ---
	const validCerts: string[] = [];
	for (const pem of parsed.signingCertificates) {
		try {
			const ok = assertValidSpCertificatePem(pem);
			if (ok) {
				validCerts.push(ok);
			}
		} catch {
			/* drop invalid cert */
		}
	}
	if (parsed.signingCertificates.length === 0) {
		warnings.push({ code: 'no_signing_certificate' });
	} else if (validCerts.length === 0) {
		warnings.push({ code: 'invalid_signing_certificate' });
	}

	// --- SLO ---
	const sloUrl = parsed.slo.redirect ?? parsed.slo.post ?? null;
	const sloSoapUrl = parsed.slo.soap ?? null;
	if (!parsed.slo.redirect && !parsed.slo.post && !parsed.slo.soap) {
		warnings.push({ code: 'no_slo' });
	}

	// --- AuthnRequestsSigned hint requires a cert to be saveable ---
	if (parsed.authnRequestsSigned && validCerts.length === 0) {
		warnings.push({ code: 'authn_requests_signed_no_cert' });
	}

	// --- validUntil expiry ---
	if (parsed.validUntil) {
		const expiry = new Date(parsed.validUntil);
		if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < options.now.getTime()) {
			warnings.push({ code: 'metadata_expired', detail: parsed.validUntil });
		}
	}

	// --- multiple entities in the document ---
	if (parsed.entityCount > 1) {
		warnings.push({ code: 'multiple_entities' });
	}

	return {
		valid: true,
		entityId: parsed.entityId,
		acsUrl: chosenAcs?.location ?? null,
		acsOptions: parsed.acs,
		sloUrl,
		sloSoapUrl,
		nameIdFormat,
		spCertificate: validCerts[0] ?? null,
		signingCertificates: validCerts,
		authnRequestsSigned: parsed.authnRequestsSigned,
		wantAssertionsSigned: parsed.wantAssertionsSigned,
		signed: parsed.signed,
		warnings,
		entityIdConflict: options.entityIdConflict,
	};
}
