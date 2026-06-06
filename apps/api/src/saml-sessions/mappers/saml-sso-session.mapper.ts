import type {
	SamlSpParticipationPublicDto,
	SamlSsoSessionPublicDto,
	SamlSsoSessionStatus,
	SamlSsoSessionTerminationReason,
} from '@nestidp/shared';
import type { SamlSpParticipation, SamlSsoSession, SpConnection } from '@prisma/client';

type ParticipationWithSp = SamlSpParticipation & { spConnection: SpConnection };
type SsoSessionWithParticipations = SamlSsoSession & {
	participations: ParticipationWithSp[];
};

export function toSamlSpParticipationPublicDto(
	row: ParticipationWithSp,
): SamlSpParticipationPublicDto {
	return {
		id: row.id,
		spConnectionId: row.spConnectionId,
		spName: row.spConnection.name,
		spEntityId: row.spConnection.spEntityId,
		sessionIndex: row.sessionIndex,
		nameId: row.nameId,
		nameIdFormat: row.nameIdFormat,
		createdAt: row.createdAt.toISOString(),
	};
}

export function toSamlSsoSessionPublicDto(
	row: SsoSessionWithParticipations,
): SamlSsoSessionPublicDto {
	return {
		id: row.id,
		userId: row.userId,
		username: row.username,
		createdAt: row.createdAt.toISOString(),
		lastSeenAt: row.lastSeenAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
		loginIp: row.loginIp,
		userAgent: row.userAgent,
		lastSeenIp: row.lastSeenIp,
		status: row.status as SamlSsoSessionStatus,
		terminatedAt: row.terminatedAt ? row.terminatedAt.toISOString() : null,
		terminatedReason: (row.terminatedReason ?? null) as SamlSsoSessionTerminationReason | null,
		participations: row.participations.map(toSamlSpParticipationPublicDto),
	};
}
