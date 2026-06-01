import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	LOGIN_PAGE_ROUTE,
	SAML_SESSION_QUERY_PARAM,
	type ParsedAuthnRequestDto,
} from '@nestidp/shared';
import { IdentityRepository } from '../identity/identity.repository';
import { PrismaService } from '../prisma/prisma.service';
import { toEndUserPublicDto } from '../auth/end-user-auth.mapper';
import { SamlAuthAuditService } from './saml-auth-audit.service';
import { SamlMetadataService } from './saml-metadata.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { SamlRequestParserService } from './saml-request-parser.service';
import { SamlResponseBuilderService } from './saml-response-builder.service';
import { validateAcsUrl } from './saml-url.util';

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
		private readonly identityRepository: IdentityRepository,
		private readonly audit: SamlAuthAuditService,
	) {}

	async getMetadataXml(): Promise<string> {
		return this.metadataService.generateMetadata();
	}

	async handleRedirectSso(
		samlRequest: string | undefined,
		relayState: string | undefined,
		clientIp: string,
	): Promise<{ redirectUrl: string }> {
		if (!samlRequest) {
			this.audit.logRequestRejected('missing_saml_request', clientIp);
			throw new BadRequestException('Missing SAMLRequest');
		}

		let parsed;
		try {
			parsed = this.parser.parseRedirectBinding(samlRequest, relayState);
		} catch (error) {
			const reason = error instanceof Error ? error.message : 'parse_failed';
			this.audit.logRequestRejected(reason, clientIp);
			throw error;
		}

		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
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
			if (this.isUniqueConstraintError(error)) {
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
		});

		const redirectUrl = `${LOGIN_PAGE_ROUTE}?${SAML_SESSION_QUERY_PARAM}=${session.id}`;
		return { redirectUrl };
	}

	async completeSso(samlSessionId: string, authenticatedUserId: string): Promise<string> {
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

		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
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

		const { samlResponseXml } = await this.responseBuilder.buildLoginResponse({
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

		await this.prisma.samlSession.delete({ where: { id: samlSessionId } });

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

	private isUniqueConstraintError(error: unknown): boolean {
		return (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error as { code: string }).code === 'P2002'
		);
	}
}
