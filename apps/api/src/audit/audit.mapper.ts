import type { AuditEvent } from '@prisma/client';
import type { AuditEventDto } from '@nestidp/shared';

export function toAuditEventDto(row: AuditEvent): AuditEventDto {
	return {
		id: row.id,
		category: row.category as AuditEventDto['category'],
		event: row.event,
		actorType: row.actorType as AuditEventDto['actorType'],
		actorId: row.actorId,
		actorLabel: row.actorLabel,
		subjectType: row.subjectType,
		subjectId: row.subjectId,
		clientIp: row.clientIp,
		metadata:
			row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
				? (row.metadata as Record<string, unknown>)
				: null,
		createdAt: row.createdAt.toISOString(),
	};
}
