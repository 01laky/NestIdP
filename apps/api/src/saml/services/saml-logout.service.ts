import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	getSamlRedirectSignatureAlgorithm,
	resolveSignatureAlgorithmIdForSigning,
	type SamlLogoutBindingType,
} from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { isUniqueConstraintError } from '../../common/utils/prisma-error.util';
import { positiveIntOrDefault } from '../../common/config/positive-int.util';
import { MAX_SAML_REQUEST_BYTES } from '../../common/constants/crypto-limits';
import { SamlSsoSessionService } from '../../saml-sessions/services/saml-sso-session.service';
import { decodeRedirectBinding } from '../utils/build-authn-request.util';
import {
	parseLogoutRequestXml,
	SamlLogoutParseError,
	type ParsedLogoutRequest,
} from '../utils/saml-logout-request-parser.util';
import { verifyEnvelopedXmlDsig } from '../utils/saml-enveloped-signature.util';
import {
	buildRedirectBindingSignedContent,
	buildSignedRedirectBindingResponse,
	verifyRedirectBindingSignature,
	type RawSamlRedirectQueryParams,
} from '../utils/saml-authn-request-redirect-signature.util';
import { getExpectedSloDestination, normalizeUrlForComparison } from '../utils/saml-url.util';
import { IdpSigningService } from './idp-signing.service';
import { SamlAuthAuditService } from './saml-auth-audit.service';
import { SamlLogoutResponseBuilderService } from './saml-logout-response-builder.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { getCachedIdpSettings } from '../../idp-settings/utils/idp-settings-cache.util';

export interface SamlRedirectSloInput {
	samlRequest: string;
	relayState?: string;
	raw: RawSamlRedirectQueryParams;
	clientIp: string;
}

export interface SamlPostSloInput {
	samlRequest: string;
	relayState?: string;
	clientIp: string;
}

export type SamlLogoutDelivery =
	| { type: 'redirect'; url: string }
	| { type: 'post'; html: string }
	| { type: 'logged-out' };

export interface SamlLogoutResult {
	delivery: SamlLogoutDelivery;
	clearEndUserCookie: boolean;
}

interface SignatureCheckResult {
	ok: boolean;
	reason?: string;
	requestWasSigned: boolean;
}

@Injectable()
export class SamlLogoutService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly sessions: SamlSsoSessionService,
		private readonly idpSigning: IdpSigningService,
		private readonly responseBuilder: SamlLogoutResponseBuilderService,
		private readonly postBinding: SamlPostBindingService,
		private readonly audit: SamlAuthAuditService,
	) {}

	async handleRedirectSlo(input: SamlRedirectSloInput): Promise<SamlLogoutResult> {
		const xml = this.decodeRedirect(input.samlRequest);
		return this.process({
			xml,
			bindingType: 'redirect',
			relayState: input.relayState,
			clientIp: input.clientIp,
			raw: input.raw,
		});
	}

	async handlePostSlo(input: SamlPostSloInput): Promise<SamlLogoutResult> {
		const xml = this.decodePost(input.samlRequest);
		return this.process({
			xml,
			bindingType: 'post',
			relayState: input.relayState,
			clientIp: input.clientIp,
		});
	}

	private async process(ctx: {
		xml: string;
		bindingType: SamlLogoutBindingType;
		relayState?: string;
		clientIp: string;
		raw?: RawSamlRedirectQueryParams;
	}): Promise<SamlLogoutResult> {
		let parsed: ParsedLogoutRequest;
		try {
			parsed = parseLogoutRequestXml(ctx.xml, ctx.bindingType, {
				clockSkewSeconds: this.getClockSkewSeconds(),
			});
		} catch (error) {
			const reason =
				error instanceof SamlLogoutParseError ? error.reason : 'logout_request_malformed';
			this.audit.logLogoutRequestRejected(reason, ctx.clientIp, ctx.bindingType);
			throw new BadRequestException(reason);
		}

		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			this.audit.logLogoutRequestRejected('idp_not_configured', ctx.clientIp, ctx.bindingType);
			throw new ServiceUnavailableException('IdP is not configured');
		}

		const sp = await this.prisma.spConnection.findUnique({
			where: { spEntityId: parsed.issuer },
		});
		if (!sp || !sp.active) {
			this.audit.logLogoutRequestRejected('unknown_or_inactive_sp', ctx.clientIp, ctx.bindingType);
			throw new BadRequestException('Unknown or inactive Service Provider');
		}

		if (parsed.destination) {
			const expected = getExpectedSloDestination(
				this.configService.get<string>('IDP_BASE_URL') ?? '',
			);
			if (normalizeUrlForComparison(parsed.destination) !== expected) {
				this.audit.logLogoutRequestRejected(
					'logout_destination_mismatch',
					ctx.clientIp,
					ctx.bindingType,
				);
				throw new BadRequestException('Invalid Destination');
			}
		}

		const signature = this.verifySignature(
			ctx.bindingType,
			parsed,
			sp.spCertificate,
			sp.wantLogoutRequestsSigned,
			ctx.raw,
		);
		if (!signature.ok) {
			this.audit.logLogoutRequestRejected(signature.reason!, ctx.clientIp, ctx.bindingType);
			throw new BadRequestException(signature.reason);
		}

		this.audit.logLogoutRequestReceived({
			spEntityId: sp.spEntityId,
			logoutRequestId: parsed.id,
			spConnectionId: sp.id,
			clientIp: ctx.clientIp,
			bindingType: ctx.bindingType,
			requestWasSigned: signature.requestWasSigned,
		});

		// Match + terminate (single-SP local invalidate).
		const match = await this.sessions.findMatchingForLogout({
			spConnectionId: sp.id,
			nameId: parsed.nameId,
			sessionIndexes: parsed.sessionIndexes,
		});
		let sessionTerminated = false;
		if (match) {
			// Terminate locally + propagate back-channel SLO to the OTHER SPs in this session — never the
			// initiator, which gets the front-channel LogoutResponse below (Prompt 36).
			const result = await this.sessions.terminate(match.ssoSessionId, 'sp_logout', undefined, {
				excludeSpConnectionId: sp.id,
			});
			sessionTerminated = result.found && !result.alreadyTerminated;
		}

		// Replay protection — recorded only AFTER the terminate succeeded (§5.C): recording first would
		// burn the request id on a terminate failure and reject the SP's legitimate retry as a replay.
		// Trade-off: a concurrent replay can race into a double terminate, which is idempotent — the
		// sessions are already gone.
		try {
			await this.sessions.recordLogoutRequestId(parsed.id, sp.id);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				this.audit.logLogoutRequestRejected(
					'logout_request_replayed',
					ctx.clientIp,
					ctx.bindingType,
				);
				throw new BadRequestException('LogoutRequest replayed');
			}
			throw error;
		}

		// Build + deliver the LogoutResponse. `logout_completed` is audited only after the response has
		// actually been built + signed (§5.C) — a signing failure must not produce a false "completed".
		const completed = (responseDelivered: boolean) =>
			this.audit.logLogoutCompleted({
				spEntityId: sp.spEntityId,
				spConnectionId: sp.id,
				bindingType: ctx.bindingType,
				responseDelivered,
				sessionTerminated,
			});

		if (!sp.sloUrl) {
			completed(false);
			return { delivery: { type: 'logged-out' }, clearEndUserCookie: true };
		}

		const built = this.responseBuilder.build({
			inResponseTo: parsed.id,
			destination: sp.sloUrl,
			idpEntityId: settings.entityId,
			status: 'success',
		});
		const material = await this.idpSigning.ensureSigningMaterial();

		if (ctx.bindingType === 'post') {
			const signedXml = this.idpSigning.signLogoutResponse(built.xml, material, built.responseId);
			const base64 = Buffer.from(signedXml, 'utf8').toString('base64');
			const html = this.postBinding.renderAutoPostForm(sp.sloUrl, base64, ctx.relayState);
			completed(true);
			return { delivery: { type: 'post', html }, clearEndUserCookie: true };
		}

		const sigAlgUri = resolveSignatureAlgorithmIdForSigning(
			material.signatureAlgorithmId,
		).xmlSignatureAlgorithm;
		const query = buildSignedRedirectBindingResponse({
			responseXml: built.xml,
			relayState: ctx.relayState,
			sigAlgUri,
			privateKeyPem: material.privateKeyPem,
		});
		const separator = sp.sloUrl.includes('?') ? '&' : '?';
		completed(true);
		return {
			delivery: { type: 'redirect', url: `${sp.sloUrl}${separator}${query}` },
			clearEndUserCookie: true,
		};
	}

	private verifySignature(
		bindingType: SamlLogoutBindingType,
		parsed: ParsedLogoutRequest,
		spCertificate: string | null,
		wantSigned: boolean,
		raw?: RawSamlRedirectQueryParams,
	): SignatureCheckResult {
		const hasSignature = bindingType === 'redirect' ? Boolean(raw?.signature) : parsed.hasSignature;

		if (!hasSignature) {
			if (wantSigned) {
				return { ok: false, reason: 'unsigned_logout_required', requestWasSigned: false };
			}
			return { ok: true, requestWasSigned: false };
		}

		if (!spCertificate?.trim()) {
			return {
				ok: false,
				reason: 'sp_certificate_required_for_signature',
				requestWasSigned: false,
			};
		}

		if (bindingType === 'post') {
			const valid = verifyEnvelopedXmlDsig(parsed.rawXml, spCertificate);
			return valid
				? { ok: true, requestWasSigned: true }
				: { ok: false, reason: 'invalid_logout_signature', requestWasSigned: false };
		}

		// Redirect binding — detached query signature.
		if (!raw?.samlRequest || !raw.sigAlg || !raw.signature) {
			return { ok: false, reason: 'invalid_logout_signature', requestWasSigned: false };
		}
		const sigAlgDecoded = decodeURIComponent(raw.sigAlg);
		if (!getSamlRedirectSignatureAlgorithm(sigAlgDecoded)) {
			return { ok: false, reason: 'unsupported_signature_algorithm', requestWasSigned: false };
		}
		const signedContent = buildRedirectBindingSignedContent({
			samlRequestRaw: raw.samlRequest,
			relayStateRaw: raw.relayState,
			sigAlgRaw: raw.sigAlg,
		});
		const valid = verifyRedirectBindingSignature({
			signedContent,
			signatureBase64UrlEncoded: raw.signature,
			sigAlgUri: sigAlgDecoded,
			certificatePem: spCertificate,
		});
		return valid
			? { ok: true, requestWasSigned: true }
			: { ok: false, reason: 'invalid_logout_signature', requestWasSigned: false };
	}

	private decodeRedirect(encoded: string): string {
		if (!encoded || encoded.trim().length === 0) {
			throw new BadRequestException('Missing SAMLRequest');
		}
		let xml: string;
		try {
			xml = decodeRedirectBinding(decodeURIComponent(encoded));
		} catch {
			throw new BadRequestException('Invalid SAMLRequest encoding');
		}
		this.assertSize(xml);
		return xml;
	}

	private decodePost(encoded: string): string {
		if (!encoded || encoded.trim().length === 0) {
			throw new BadRequestException('Missing SAMLRequest');
		}
		// Buffer.from(..., 'base64') never throws — malformed input just yields bytes that fail XML parsing.
		const xml = Buffer.from(encoded, 'base64').toString('utf8');
		if (
			xml.length > 0 &&
			xml.charCodeAt(0) < 0x20 &&
			xml.charCodeAt(0) !== 0x09 &&
			xml.charCodeAt(0) !== 0x0a &&
			xml.charCodeAt(0) !== 0x0d
		) {
			throw new BadRequestException('Invalid SAMLRequest encoding — deflate not accepted for POST');
		}
		this.assertSize(xml);
		return xml;
	}

	private assertSize(xml: string): void {
		if (Buffer.byteLength(xml, 'utf8') > MAX_SAML_REQUEST_BYTES) {
			throw new BadRequestException('SAMLRequest too large');
		}
	}

	private getClockSkewSeconds(): number {
		return positiveIntOrDefault(
			this.configService.get<number | string>('SAML_CLOCK_SKEW_SECONDS'),
			120,
		);
	}
}
