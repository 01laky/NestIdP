import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
	EndUserLoginResponseDto,
	EndUserPublicDto,
	EndUserSessionStatusResponseDto,
} from '@nestidp/shared';
import { isPasswordHashAlgorithm } from '@nestidp/shared';
import { verifyPasswordTimingSafe } from '../../admin-auth/utils/password.util';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import { PrismaService } from '../../prisma/services/prisma.service';
import { EndUserAuthAuditService } from './end-user-auth-audit.service';
import { toEndUserPublicDto } from '../mappers/end-user-auth.mapper';
import { IdpSigningService } from '../../saml/services/idp-signing.service';
import { SamlSessionBindService } from './saml-session-bind.service';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

@Injectable()
export class EndUserAuthService {
	constructor(
		private readonly identityRepository: ActiveIdentityStore,
		private readonly samlSessionBindService: SamlSessionBindService,
		private readonly prisma: PrismaService,
		private readonly idpSigningService: IdpSigningService,
		private readonly audit: EndUserAuthAuditService,
	) {}

	async login(
		username: string,
		password: string,
		options?: { samlSessionId?: string; clientIp?: string },
	): Promise<EndUserLoginResponseDto> {
		const trimmedUsername = username.trim();
		const clientIp = options?.clientIp ?? 'unknown';
		const user = await this.identityRepository.findUserByUsername(trimmedUsername);

		const rejectLogin = async (
			reason: 'invalid_credentials' | 'inactive' | 'unsupported_algorithm',
		): Promise<never> => {
			await verifyPasswordTimingSafe(password, null);
			if (user && reason === 'unsupported_algorithm') {
				this.audit.logUnsupportedAlgorithm(user.id);
			}
			this.audit.logLoginFailure(trimmedUsername, clientIp, reason);
			throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
		};

		if (!user || !user.active) {
			return rejectLogin(user && !user.active ? 'inactive' : 'invalid_credentials');
		}

		if (!isPasswordHashAlgorithm(user.passwordHashAlgorithm)) {
			return rejectLogin('unsupported_algorithm');
		}

		const valid = await verifyPasswordTimingSafe(password, user.passwordHash);
		if (!valid) {
			return rejectLogin('invalid_credentials');
		}

		let samlSessionBound = false;
		if (options?.samlSessionId) {
			try {
				await this.samlSessionBindService.bindUserToSession(options.samlSessionId, user.id);
				samlSessionBound = true;
			} catch (error) {
				const reason = error instanceof Error ? error.message : 'saml_bind_failed';
				this.audit.logSamlBindFailure(options.samlSessionId, clientIp, reason);
				throw error;
			}
		}

		const profile = await this.identityRepository.findUserProfileById(user.id);
		if (!profile) {
			throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
		}

		this.audit.logLoginSuccess(user.id, user.username, clientIp, samlSessionBound);

		return {
			ok: true,
			user: toEndUserPublicDto(profile),
			samlSessionBound,
		};
	}

	async getMe(userId: string): Promise<EndUserPublicDto> {
		const profile = await this.identityRepository.findUserProfileById(userId);
		if (!profile || !profile.active) {
			throw new UnauthorizedException('Unauthorized');
		}
		return toEndUserPublicDto(profile);
	}

	async getSessionStatus(options: {
		userId?: string;
		samlSessionId?: string;
	}): Promise<EndUserSessionStatusResponseDto> {
		// Strict SP-only IdP (Prompt 36, Deliverable 10): the end user is never a standing portal user.
		// We resolve the cookie profile only to drive the *pending SSO request*; we never advertise a
		// standing session (authenticated / username) when there is no live request the user belongs to.
		const profile = options.userId
			? await this.identityRepository.findUserProfileById(options.userId)
			: null;
		const profileActive = Boolean(profile?.active);

		let samlSession: EndUserSessionStatusResponseDto['samlSession'] = null;
		let belongsToRequest = false;
		if (options.samlSessionId) {
			const row = await this.prisma.samlSession.findUnique({
				where: { id: options.samlSessionId },
				include: { spConnection: true },
			});
			if (row) {
				const bound = row.userId != null;
				const expired = row.expiresAt <= new Date();
				const spActive = row.spConnection.active;
				const idpSettings = await this.prisma.idpSettings.findUnique({
					where: { id: 'default' },
				});
				const hasSigning =
					(await this.idpSigningService.hasSigningMaterial()) || idpSettings != null;
				const userMatches =
					options.userId != null && row.userId != null && options.userId === row.userId;
				belongsToRequest = userMatches && profileActive;
				const readyToComplete =
					!expired && bound && spActive && hasSigning && userMatches && profileActive;

				samlSession = {
					id: row.id,
					bound,
					expired,
					spActive,
					readyToComplete,
				};
			}
		}

		// Identity is exposed only inside a pending SSO request the cookie's user belongs to — never
		// from the cookie alone (no standing-session leak).
		const authenticated = belongsToRequest;
		const user: EndUserPublicDto | null =
			belongsToRequest && profile ? toEndUserPublicDto(profile) : null;

		return { authenticated, user, samlSession };
	}
}
