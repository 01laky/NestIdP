import { Injectable, Logger } from '@nestjs/common';
import type {
	SamlSsoSessionListQueryDto,
	SamlSsoSessionListResponseDto,
	SamlSsoSessionStatusFilter,
	SamlSsoSessionTerminationReason,
} from '@nestidp/shared';
import { SAML_SESSIONS_LIST_PAGE_SIZE } from '@nestidp/shared';
import type { Prisma } from '@prisma/client';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import { toSamlSsoSessionPublicDto } from '../mappers/saml-sso-session.mapper';

const USER_AGENT_MAX_LENGTH = 512;

export interface CreateSsoSessionInput {
	userId: string | null;
	username: string;
	expiresAt: Date;
	loginIp?: string | null;
	userAgent?: string | null;
}

export interface CreateParticipationInput {
	ssoSessionId: string;
	spConnectionId: string;
	sessionIndex: string;
	nameId: string;
	nameIdFormat: string;
}

export interface LogoutMatchInput {
	spConnectionId: string;
	nameId: string;
	sessionIndexes: string[];
}

/**
 * Registry of revocable IdP SSO sessions (the server-side record behind the
 * otherwise-stateless end-user cookie) and their per-SP assertion participations.
 * Lives in a dedicated low-level module so SamlModule, AuthModule, and IdentityModule
 * can all use it without a cycle.
 */
@Injectable()
export class SamlSsoSessionService {
	private readonly logger = new Logger(SamlSsoSessionService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly audit: AuditPersistenceService,
	) {}

	async create(input: CreateSsoSessionInput): Promise<{ id: string }> {
		const session = await this.prisma.samlSsoSession.create({
			data: {
				userId: input.userId,
				username: input.username,
				expiresAt: input.expiresAt,
				loginIp: input.loginIp ?? null,
				userAgent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
				lastSeenIp: input.loginIp ?? null,
			},
			select: { id: true },
		});
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_sso_session_started',
			actorType: 'end_user',
			actorId: input.userId ?? undefined,
			subjectType: 'SamlSsoSession',
			subjectId: session.id,
			clientIp: input.loginIp ?? undefined,
			metadata: { username: input.username },
		});
		return session;
	}

	async createParticipation(input: CreateParticipationInput): Promise<void> {
		await this.prisma.samlSpParticipation.create({
			data: {
				ssoSessionId: input.ssoSessionId,
				spConnectionId: input.spConnectionId,
				sessionIndex: input.sessionIndex,
				nameId: input.nameId,
				nameIdFormat: input.nameIdFormat,
			},
		});
	}

	async isActive(sid: string | undefined | null): Promise<boolean> {
		if (!sid) {
			return false;
		}
		const session = await this.prisma.samlSsoSession.findUnique({
			where: { id: sid },
			select: { status: true, expiresAt: true },
		});
		return Boolean(session && session.status === 'active' && session.expiresAt > new Date());
	}

	/** Best-effort sliding activity update — never throws. */
	async touch(sid: string | undefined | null, ip?: string | null): Promise<void> {
		if (!sid) {
			return;
		}
		try {
			await this.prisma.samlSsoSession.updateMany({
				where: { id: sid, status: 'active' },
				data: { lastSeenAt: new Date(), lastSeenIp: ip ?? undefined },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn(JSON.stringify({ event: 'sso_session_touch_failed', message }));
		}
	}

	async terminate(
		id: string,
		reason: SamlSsoSessionTerminationReason,
		adminId?: string,
	): Promise<{ alreadyTerminated: boolean; found: boolean }> {
		const existing = await this.prisma.samlSsoSession.findUnique({
			where: { id },
			select: { status: true },
		});
		if (!existing) {
			return { alreadyTerminated: false, found: false };
		}
		if (existing.status === 'terminated') {
			return { alreadyTerminated: true, found: true };
		}
		await this.prisma.samlSsoSession.update({
			where: { id },
			data: {
				status: 'terminated',
				terminatedAt: new Date(),
				terminatedReason: reason,
				terminatedByAdminId: adminId ?? null,
			},
		});
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_session_terminated',
			actorType: reason === 'admin_action' || reason === 'user_deactivated' ? 'admin' : 'system',
			actorId: adminId ?? undefined,
			subjectType: 'SamlSsoSession',
			subjectId: id,
			metadata: { reason },
		});
		return { alreadyTerminated: false, found: true };
	}

	async terminateAllForUser(
		userId: string,
		reason: SamlSsoSessionTerminationReason,
		adminId?: string,
	): Promise<number> {
		const sessions = await this.prisma.samlSsoSession.findMany({
			where: { userId, status: 'active' },
			select: { id: true },
		});
		let count = 0;
		for (const session of sessions) {
			const result = await this.terminate(session.id, reason, adminId);
			if (result.found && !result.alreadyTerminated) {
				count += 1;
			}
		}
		return count;
	}

	/**
	 * Find an active session to terminate for an inbound LogoutRequest. Matches a
	 * participation by (spConnectionId + sessionIndex when present, else nameId), then
	 * cross-checks the NameID. Returns the parent session id, or null when nothing matches.
	 */
	async findMatchingForLogout(input: LogoutMatchInput): Promise<{ ssoSessionId: string } | null> {
		const where: Prisma.SamlSpParticipationWhereInput = {
			spConnectionId: input.spConnectionId,
			nameId: input.nameId,
			ssoSession: { status: 'active' },
		};
		if (input.sessionIndexes.length > 0) {
			where.sessionIndex = { in: input.sessionIndexes };
		}
		const participation = await this.prisma.samlSpParticipation.findFirst({
			where,
			orderBy: { createdAt: 'desc' },
			select: { ssoSessionId: true },
		});
		return participation ? { ssoSessionId: participation.ssoSessionId } : null;
	}

	/** Replay protection: record a processed LogoutRequest id; throws on duplicate (P2002). */
	async recordLogoutRequestId(requestId: string, spConnectionId: string): Promise<void> {
		await this.prisma.samlLogoutRequestLog.create({
			data: { requestId, spConnectionId },
		});
	}

	async listForAdmin(query: SamlSsoSessionListQueryDto): Promise<SamlSsoSessionListResponseDto> {
		const status: SamlSsoSessionStatusFilter = query.status ?? 'active';
		const page = query.page && query.page > 0 ? query.page : 1;
		const pageSize =
			query.pageSize && query.pageSize > 0 ? query.pageSize : SAML_SESSIONS_LIST_PAGE_SIZE;

		const where: Prisma.SamlSsoSessionWhereInput = {};
		if (status === 'active') {
			where.status = 'active';
		} else if (status === 'terminated') {
			where.status = 'terminated';
		}
		if (query.spConnectionId) {
			where.participations = { some: { spConnectionId: query.spConnectionId } };
		}
		if (query.q && query.q.trim().length > 0) {
			const q = query.q.trim();
			where.OR = [
				{ username: { contains: q } },
				{ participations: { some: { nameId: { contains: q } } } },
			];
		}

		const [total, rows] = await Promise.all([
			this.prisma.samlSsoSession.count({ where }),
			this.prisma.samlSsoSession.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				skip: (page - 1) * pageSize,
				take: pageSize,
				include: { participations: { include: { spConnection: true } } },
			}),
		]);

		return { items: rows.map(toSamlSsoSessionPublicDto), total };
	}
}
