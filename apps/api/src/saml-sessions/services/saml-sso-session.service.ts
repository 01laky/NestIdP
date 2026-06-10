import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
	LogoutPropagationPort,
	SamlSsoSessionListQueryDto,
	SamlSsoSessionListResponseDto,
	SamlSsoSessionStatusFilter,
	SamlSsoSessionTerminationReason,
	TerminateSessionOptions,
} from '@nestidp/shared';
import { LOGOUT_PROPAGATION_PORT, SAML_SESSIONS_LIST_PAGE_SIZE } from '@nestidp/shared';
import { Prisma } from '@prisma/client';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import { toSamlSsoSessionPublicDto } from '../mappers/saml-sso-session.mapper';

const USER_AGENT_MAX_LENGTH = 512;

/** Escape LIKE metacharacters so `%`/`_` in a search term match literally (used with `ESCAPE '\'`, §B7). */
function escapeLike(term: string): string {
	return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
		// Optional so unit tests can `new SamlSsoSessionService(prisma, audit)`; the @Global
		// BackchannelLogoutModule provides the real implementation in production (Prompt 36).
		@Optional()
		@Inject(LOGOUT_PROPAGATION_PORT)
		private readonly propagation?: LogoutPropagationPort,
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

	async createParticipation(
		input: CreateParticipationInput,
		tx?: Prisma.TransactionClient,
	): Promise<void> {
		await (tx ?? this.prisma).samlSpParticipation.create({
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
		options?: TerminateSessionOptions,
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
			actorType:
				reason === 'admin_action' || reason === 'user_deactivated' || reason === 'user_deleted'
					? 'admin'
					: 'system',
			actorId: adminId ?? undefined,
			subjectType: 'SamlSsoSession',
			subjectId: id,
			metadata: { reason },
		});
		// Back-channel (SOAP) SLO fan-out to the session's other SPs (Prompt 36). Best-effort, never blocks
		// — the local logout above is authoritative.
		if (this.propagation) {
			await this.propagation
				.propagateLogout({
					ssoSessionId: id,
					reason,
					excludeSpConnectionId: options?.excludeSpConnectionId,
				})
				.catch(() => undefined);
		}
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

	/** Bulk-terminate selected sessions (Prompt 36); each fans out back-channel propagation. */
	async terminateBulk(
		ids: string[],
		adminId?: string,
	): Promise<{
		results: { id: string; outcome: 'terminated' | 'already_terminated' | 'not_found' }[];
		terminatedCount: number;
	}> {
		const results: { id: string; outcome: 'terminated' | 'already_terminated' | 'not_found' }[] =
			[];
		let terminatedCount = 0;
		for (const id of ids) {
			const result = await this.terminate(id, 'admin_action', adminId);
			const outcome = !result.found
				? 'not_found'
				: result.alreadyTerminated
					? 'already_terminated'
					: 'terminated';
			if (outcome === 'terminated') {
				terminatedCount += 1;
			}
			results.push({ id, outcome });
		}
		return { results, terminatedCount };
	}

	/** Emergency kill-switch: terminate every active session (Prompt 36). */
	async terminateAllActive(adminId?: string): Promise<number> {
		const sessions = await this.prisma.samlSsoSession.findMany({
			where: { status: 'active' },
			select: { id: true },
		});
		let count = 0;
		for (const session of sessions) {
			const result = await this.terminate(session.id, 'admin_action', adminId);
			if (result.found && !result.alreadyTerminated) {
				count += 1;
			}
		}
		return count;
	}

	/** Back-channel delivery queue health counts (Prompt 36). */
	async backchannelQueueHealth(): Promise<{
		pending: number;
		inFlight: number;
		succeeded: number;
		partial: number;
		failed: number;
		givenUp: number;
		skipped: number;
	}> {
		const grouped = await this.prisma.samlBackchannelLogout.groupBy({
			by: ['status'],
			_count: { _all: true },
		});
		const get = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
		return {
			pending: get('pending'),
			inFlight: get('in_flight'),
			succeeded: get('succeeded'),
			partial: get('partial'),
			failed: get('failed'),
			givenUp: get('given_up'),
			skipped: get('skipped_no_endpoint'),
		};
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

	/**
	 * libSQL search path mirroring IdentityRepository.listUsersWithSearch (Prompt 38 §5.C/§B7): Prisma
	 * `contains` translates to `LIKE '%term%'` with no `ESCAPE` clause, so a literal `%`/`_` in the term
	 * would act as a wildcard. Resolve the matching session ids (by username or participation NameID)
	 * with an escaped raw `LIKE … ESCAPE '\'`, then let the regular Prisma query apply the remaining
	 * filters + pagination over the id set.
	 */
	private async searchSessionIds(term: string): Promise<string[]> {
		const pat = `%${escapeLike(term)}%`;
		const rows = await this.prisma.$queryRaw<{ id: string }[]>(
			Prisma.sql`SELECT "id" FROM "SamlSsoSession" WHERE "username" LIKE ${pat} ESCAPE '\\' UNION SELECT "ssoSessionId" AS "id" FROM "SamlSpParticipation" WHERE "nameId" LIKE ${pat} ESCAPE '\\'`,
		);
		return rows.map((r) => r.id);
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
			where.id = { in: await this.searchSessionIds(query.q.trim()) };
		}
		// Filter by the signed-in user's originating identity source (Prompt 37).
		if (query.apiConnectionId) {
			const userIds = await this.prisma.user.findMany({
				where: { apiConnectionId: query.apiConnectionId },
				select: { id: true },
			});
			where.userId = { in: userIds.map((u) => u.id) };
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

		// Per-SP back-channel delivery state for the page's sessions (Prompt 36, item N).
		const sessionIds = rows.map((r) => r.id);
		const bcRows = sessionIds.length
			? await this.prisma.samlBackchannelLogout.findMany({
					where: { ssoSessionId: { in: sessionIds } },
					include: { spConnection: { select: { name: true } } },
					orderBy: { createdAt: 'asc' },
				})
			: [];
		const bcBySession = new Map<string, typeof bcRows>();
		for (const bc of bcRows) {
			const list = bcBySession.get(bc.ssoSessionId);
			if (list) {
				list.push(bc);
			} else {
				bcBySession.set(bc.ssoSessionId, [bc]);
			}
		}

		// Resolve each session user's originating identity source (Prompt 37). Best-effort: under an
		// external identity DB the local User table is empty, so source is left null (no leak).
		const userIds = [
			...new Set(rows.map((r) => r.userId).filter((id): id is string => id != null)),
		];
		const sourceByUser = new Map<string, { apiConnectionId: string; label: string }>();
		if (userIds.length > 0) {
			const users = await this.prisma.user.findMany({
				where: { id: { in: userIds } },
				select: {
					id: true,
					apiConnectionId: true,
					apiConnection: { select: { name: true, isLocalDirectory: true } },
				},
			});
			for (const u of users) {
				sourceByUser.set(u.id, {
					apiConnectionId: u.apiConnectionId,
					label: u.apiConnection.isLocalDirectory ? 'Local directory' : u.apiConnection.name,
				});
			}
		}

		return {
			items: rows.map((r) => {
				const dto = toSamlSsoSessionPublicDto(r, bcBySession.get(r.id) ?? []);
				const source = r.userId ? sourceByUser.get(r.userId) : undefined;
				return {
					...dto,
					sourceApiConnectionId: source?.apiConnectionId ?? null,
					sourceLabel: source?.label ?? null,
				};
			}),
			total,
		};
	}
}
