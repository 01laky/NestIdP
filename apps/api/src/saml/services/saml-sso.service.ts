import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import { isUniqueConstraintError } from '../../common/utils/prisma-error.util';
import { ConfigService } from '@nestjs/config';
import {
	LOGIN_PAGE_ROUTE,
	SAML_SESSION_QUERY_PARAM,
	type ParsedAuthnRequestDto,
} from '@nestidp/shared';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import { PrismaService } from '../../prisma/services/prisma.service';
import { toEndUserPublicDto } from '../../auth/mappers/end-user-auth.mapper';
import { SamlAuthAuditService } from './saml-auth-audit.service';
import { SamlMetadataService } from './saml-metadata.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { SamlRequestParserService } from './saml-request-parser.service';
import { SamlResponseBuilderService } from './saml-response-builder.service';
import { validateAcsUrl } from '../utils/saml-url.util';
import { verifyEnvelopedXmlDsig } from '../utils/saml-enveloped-signature.util';
import { SamlSsoSessionService } from '../../saml-sessions/services/saml-sso-session.service';
import type { RawSamlRedirectQueryParams } from '../utils/saml-authn-request-redirect-signature.util';
import {
	buildRedirectBindingSignedContent,
	verifyRedirectBindingSignature,
} from '../utils/saml-authn-request-redirect-signature.util';
import { getSamlRedirectSignatureAlgorithm } from '@nestidp/shared';
import { getCachedIdpSettings } from '../../idp-settings/utils/idp-settings-cache.util';

export interface SamlPostSsoInput {
	samlRequest: string;
	relayState?: string;
	clientIp: string;
}

export interface SamlRedirectSsoInput {
	decoded: {
		samlRequest: string;
		relayState?: string;
	};
	raw: RawSamlRedirectQueryParams;
	clientIp: string;
}

@Injectable()
export class SamlSsoService {
	private readonly logger = new Logger(SamlSsoService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly parser: SamlRequestParserService,
		private readonly responseBuilder: SamlResponseBuilderService,
		private readonly postBinding: SamlPostBindingService,
		private readonly metadataService: SamlMetadataService,
		private readonly identityRepository: ActiveIdentityStore,
		private readonly audit: SamlAuthAuditService,
		private readonly ssoSessions: SamlSsoSessionService,
	) {}

	async getMetadataXml(): Promise<string> {
		return this.metadataService.generateMetadata();
	}

	async handleRedirectSso(input: SamlRedirectSsoInput): Promise<{ redirectUrl: string }> {
		const { decoded, raw, clientIp } = input;
		if (!decoded.samlRequest) {
			this.audit.logRequestRejected('missing_saml_request', clientIp);
			throw new BadRequestException('Missing SAMLRequest');
		}

		let parsed;
		try {
			parsed = await this.parser.parseRedirectBinding(decoded.samlRequest, decoded.relayState);
		} catch (error) {
			const reason = this.mapParseErrorToAuditReason(error);
			this.audit.logRequestRejected(reason, clientIp);
			throw error;
		}

		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			this.audit.logRequestRejected('idp_not_configured', clientIp);
			throw new ServiceUnavailableException('IdP is not configured');
		}

		const sp = await this.prisma.spConnection.findUnique({
			where: { spEntityId: parsed.authnRequest.issuer },
		});

		if (!sp || !sp.active) {
			this.audit.logRequestRejected('unknown_or_inactive_sp', clientIp);
			throw new BadRequestException('Unknown or inactive Service Provider');
		}

		if (parsed.requestWasEncrypted) {
			this.audit.logRequestDecrypted({
				spEntityId: sp.spEntityId,
				samlRequestId: parsed.authnRequest.id,
				spConnectionId: sp.id,
			});
		}

		const signatureResult = this.verifyRedirectSignature(
			raw,
			sp.spCertificate,
			sp.wantAuthnRequestsSigned,
		);
		if (!signatureResult.ok) {
			this.audit.logRequestRejected(signatureResult.reason!, clientIp);
			throw new BadRequestException(signatureResult.message ?? 'Invalid SAMLRequest signature');
		}

		if (signatureResult.requestWasSigned && signatureResult.sigAlgUri) {
			this.audit.logRequestSignatureVerified({
				spEntityId: sp.spEntityId,
				samlRequestId: parsed.authnRequest.id,
				spConnectionId: sp.id,
				sigAlgUri: signatureResult.sigAlgUri,
			});
		}

		if (!parsed.authnRequest.destination) {
			this.logger.log(
				JSON.stringify({ event: 'saml_destination_missing', spEntityId: sp.spEntityId }),
			);
		}

		const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
		try {
			validateAcsUrl(sp.acsUrl, nodeEnv);
		} catch {
			this.audit.logRequestRejected('invalid_acs_url', clientIp);
			throw new BadRequestException('Invalid Service Provider ACS URL');
		}

		const expiresAt = new Date(Date.now() + this.getSessionTtlSeconds() * 1000);

		let session;
		try {
			session = await this.prisma.samlSession.create({
				data: {
					samlRequestId: parsed.authnRequest.id,
					relayState: parsed.relayState ?? null,
					spConnectionId: sp.id,
					expiresAt,
				},
			});
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				this.audit.logRequestRejected('duplicate_saml_request_id', clientIp);
				throw new ConflictException('Duplicate SAML request ID');
			}
			throw error;
		}

		this.audit.logRequestReceived({
			spEntityId: sp.spEntityId,
			samlRequestId: parsed.authnRequest.id,
			spConnectionId: sp.id,
			clientIp,
			requestWasSigned: signatureResult.requestWasSigned,
			requestWasEncrypted: parsed.requestWasEncrypted ?? false,
			sigAlgUri: signatureResult.sigAlgUri,
			bindingType: 'redirect',
		});

		const redirectUrl = `${LOGIN_PAGE_ROUTE}?${SAML_SESSION_QUERY_PARAM}=${session.id}`;
		return { redirectUrl };
	}

	async handlePostSso(input: SamlPostSsoInput): Promise<{ redirectUrl: string }> {
		const { samlRequest, relayState, clientIp } = input;
		if (!samlRequest) {
			this.audit.logRequestRejected('missing_saml_request', clientIp, 'post');
			throw new BadRequestException('Missing SAMLRequest');
		}

		let parsed;
		try {
			parsed = await this.parser.parsePostBinding(samlRequest, relayState);
		} catch (error) {
			const reason = this.mapParseErrorToAuditReason(error);
			this.audit.logRequestRejected(reason, clientIp, 'post');
			throw error;
		}

		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			this.audit.logRequestRejected('idp_not_configured', clientIp, 'post');
			throw new ServiceUnavailableException('IdP is not configured');
		}

		const sp = await this.prisma.spConnection.findUnique({
			where: { spEntityId: parsed.authnRequest.issuer },
		});

		if (!sp || !sp.active) {
			this.audit.logRequestRejected('unknown_or_inactive_sp', clientIp, 'post');
			throw new BadRequestException('Unknown or inactive Service Provider');
		}

		if (parsed.requestWasEncrypted) {
			this.audit.logRequestDecrypted({
				spEntityId: sp.spEntityId,
				samlRequestId: parsed.authnRequest.id,
				spConnectionId: sp.id,
			});
		}

		// Verify enveloped XML-DSig if present
		if (parsed.requestWasSigned) {
			if (!sp.spCertificate?.trim()) {
				this.audit.logRequestRejected('sp_certificate_required_for_signature', clientIp, 'post');
				throw new BadRequestException('SP certificate is required to verify SAMLRequest signature');
			}
			// parsed.rawAuthnRequestXml is the (decrypted) AuthnRequest XML containing the signature
			const valid = this.verifyEnvelopedXmlDsig(parsed.rawAuthnRequestXml, sp.spCertificate);
			if (!valid) {
				this.audit.logRequestRejected('invalid_saml_request_signature', clientIp, 'post');
				throw new BadRequestException('Invalid SAMLRequest signature');
			}
			this.audit.logRequestSignatureVerified({
				spEntityId: sp.spEntityId,
				samlRequestId: parsed.authnRequest.id,
				spConnectionId: sp.id,
				sigAlgUri: 'enveloped',
			});
		} else if (sp.wantAuthnRequestsSigned) {
			this.audit.logRequestRejected('unsigned_request_required', clientIp, 'post');
			throw new BadRequestException('Signed AuthnRequest is required for this Service Provider');
		}

		const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
		try {
			validateAcsUrl(sp.acsUrl, nodeEnv);
		} catch {
			this.audit.logRequestRejected('invalid_acs_url', clientIp, 'post');
			throw new BadRequestException('Invalid Service Provider ACS URL');
		}

		const expiresAt = new Date(Date.now() + this.getSessionTtlSeconds() * 1000);

		let session;
		try {
			session = await this.prisma.samlSession.create({
				data: {
					samlRequestId: parsed.authnRequest.id,
					relayState: parsed.relayState ?? null,
					spConnectionId: sp.id,
					expiresAt,
				},
			});
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				this.audit.logRequestRejected('duplicate_saml_request_id', clientIp, 'post');
				throw new ConflictException('Duplicate SAML request ID');
			}
			throw error;
		}

		this.audit.logRequestReceived({
			spEntityId: sp.spEntityId,
			samlRequestId: parsed.authnRequest.id,
			spConnectionId: sp.id,
			clientIp,
			requestWasSigned: parsed.requestWasSigned,
			requestWasEncrypted: parsed.requestWasEncrypted,
			bindingType: 'post',
		});

		const redirectUrl = `${LOGIN_PAGE_ROUTE}?${SAML_SESSION_QUERY_PARAM}=${session.id}`;
		return { redirectUrl };
	}

	private verifyEnvelopedXmlDsig(authnRequestXml: string, spCertPem: string): boolean {
		return verifyEnvelopedXmlDsig(authnRequestXml, spCertPem);
	}

	private verifyRedirectSignature(
		raw: RawSamlRedirectQueryParams,
		spCertificate: string | null,
		wantAuthnRequestsSigned: boolean,
	): {
		ok: boolean;
		reason?: string;
		message?: string;
		requestWasSigned: boolean;
		sigAlgUri?: string;
	} {
		const hasSignature = Boolean(raw.signature);
		const hasSigAlg = Boolean(raw.sigAlg);

		if (hasSignature !== hasSigAlg) {
			return {
				ok: false,
				reason: 'invalid_signature_params',
				message: 'Invalid SAMLRequest signature parameters',
				requestWasSigned: false,
			};
		}

		if (!hasSignature) {
			if (wantAuthnRequestsSigned) {
				return {
					ok: false,
					reason: 'unsigned_request_required',
					message: 'Signed AuthnRequest is required for this Service Provider',
					requestWasSigned: false,
				};
			}
			return { ok: true, requestWasSigned: false };
		}

		if (!spCertificate?.trim()) {
			return {
				ok: false,
				reason: 'sp_certificate_required_for_signature',
				message: 'SP certificate is required to verify SAMLRequest signature',
				requestWasSigned: false,
			};
		}

		if (!raw.samlRequest || !raw.sigAlg || !raw.signature) {
			return {
				ok: false,
				reason: 'invalid_signature_params',
				message: 'Invalid SAMLRequest signature parameters',
				requestWasSigned: false,
			};
		}

		const sigAlgDecoded = decodeURIComponent(raw.sigAlg);
		if (!getSamlRedirectSignatureAlgorithm(sigAlgDecoded)) {
			return {
				ok: false,
				reason: 'unsupported_signature_algorithm',
				message: 'Unsupported SAMLRequest signature algorithm',
				requestWasSigned: false,
			};
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

		if (!valid) {
			return {
				ok: false,
				reason: 'invalid_saml_request_signature',
				message: 'Invalid SAMLRequest signature',
				requestWasSigned: false,
			};
		}

		return { ok: true, requestWasSigned: true, sigAlgUri: sigAlgDecoded };
	}

	private mapParseErrorToAuditReason(error: unknown): string {
		if (!(error instanceof BadRequestException)) {
			return 'parse_failed';
		}
		const message = error.message;
		if (message.includes('encryption certificate is not configured')) {
			return 'encrypted_request_idp_key_missing';
		}
		if (message.includes('EC IdP encryption key')) {
			return 'encrypted_request_ec_key_not_supported';
		}
		if (message.includes('decrypt')) {
			return 'encrypted_request_decrypt_failed';
		}
		return message;
	}

	async completeSso(
		samlSessionId: string,
		authenticatedUserId: string,
		ssoSessionId?: string,
	): Promise<string> {
		if (ssoSessionId && !(await this.ssoSessions.isActive(ssoSessionId))) {
			this.audit.logResponseFailed(samlSessionId, 'sso_session_terminated');
			throw new BadRequestException('SSO session has been terminated');
		}

		const session = await this.prisma.samlSession.findUnique({
			where: { id: samlSessionId },
			include: { spConnection: true },
		});

		if (!session) {
			this.audit.logResponseFailed(samlSessionId, 'session_not_found');
			throw new BadRequestException('SAML session not found');
		}

		if (session.expiresAt <= new Date()) {
			this.audit.logResponseFailed(samlSessionId, 'session_expired');
			throw new BadRequestException('SAML session expired');
		}

		if (!session.spConnection.active) {
			this.audit.logResponseFailed(samlSessionId, 'sp_inactive');
			throw new BadRequestException('Service Provider is inactive');
		}

		if (!session.userId) {
			this.audit.logResponseFailed(samlSessionId, 'session_not_bound');
			throw new BadRequestException('SAML session is not bound to a user');
		}

		if (session.userId !== authenticatedUserId) {
			this.audit.logResponseFailed(samlSessionId, 'user_mismatch');
			throw new ForbiddenException('SAML session does not belong to the authenticated user');
		}

		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			this.audit.logResponseFailed(samlSessionId, 'idp_not_configured');
			throw new ServiceUnavailableException('IdP is not configured');
		}

		const profile = await this.identityRepository.findUserProfileById(session.userId);
		if (!profile?.active) {
			this.audit.logResponseFailed(samlSessionId, 'user_inactive');
			throw new BadRequestException('User is not active');
		}

		const authnRequest: ParsedAuthnRequestDto = {
			id: session.samlRequestId,
			issuer: session.spConnection.spEntityId,
			issueInstant: session.createdAt.toISOString(),
		};

		const { samlResponseXml, sessionIndex, nameId, nameIdFormat } =
			await this.responseBuilder.buildLoginResponse({
				authnRequest,
				user: toEndUserPublicDto(profile),
				spConnection: session.spConnection,
				idpEntityId: settings.entityId,
			});

		const base64Response = Buffer.from(samlResponseXml, 'utf8').toString('base64');
		const html = this.postBinding.renderAutoPostForm(
			session.spConnection.acsUrl,
			base64Response,
			session.relayState ?? undefined,
		);

		// §14: participation-create + one-time SAML-session delete are atomic — a crash between them
		// would otherwise leave either a replayable pending session (participation without delete) or
		// an SSO session the SLO fan-out doesn't know about (delete without participation).
		if (ssoSessionId) {
			await this.prisma.$transaction(async (tx) => {
				await this.ssoSessions.createParticipation(
					{
						ssoSessionId,
						spConnectionId: session.spConnectionId,
						sessionIndex,
						nameId,
						nameIdFormat,
					},
					tx,
				);
				await tx.samlSession.delete({ where: { id: samlSessionId } });
			});
		} else {
			await this.prisma.samlSession.delete({ where: { id: samlSessionId } });
		}

		this.audit.logResponseIssued({
			samlSessionId,
			userId: session.userId,
			spEntityId: session.spConnection.spEntityId,
		});

		return html;
	}

	private getSessionTtlSeconds(): number {
		const raw = this.configService.get<number | string>('SAML_SESSION_TTL_SECONDS');
		if (raw == null || raw === '') {
			return 900;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
	}
}
