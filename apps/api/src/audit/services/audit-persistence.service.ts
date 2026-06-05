import { Injectable, Logger } from '@nestjs/common';
import type { AuditActorType, AuditCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { sanitizeAuditMetadata } from '../utils/audit-metadata.util';

export interface AuditRecordInput {
	category: AuditCategory;
	event: string;
	actorType: AuditActorType;
	actorId?: string | null;
	actorLabel?: string | null;
	subjectType?: string | null;
	subjectId?: string | null;
	clientIp?: string | null;
	metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditPersistenceService {
	private readonly logger = new Logger(AuditPersistenceService.name);

	constructor(private readonly prisma: PrismaService) {}

	recordSafe(input: AuditRecordInput): void {
		const payload = this.buildStdoutPayload(input);
		this.logger.log(JSON.stringify(payload));

		void this.persist(input).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn(JSON.stringify({ event: 'audit_persist_failed', message }));
		});
	}

	private buildStdoutPayload(input: AuditRecordInput): Record<string, unknown> {
		return {
			event: input.event,
			category: input.category,
			actorType: input.actorType,
			actorId: input.actorId ?? null,
			actorLabel: input.actorLabel ?? null,
			subjectType: input.subjectType ?? null,
			subjectId: input.subjectId ?? null,
			clientIp: input.clientIp ?? null,
			metadata: sanitizeAuditMetadata(input.metadata),
		};
	}

	private async persist(input: AuditRecordInput): Promise<void> {
		const metadata = sanitizeAuditMetadata(input.metadata);
		await this.prisma.auditEvent.create({
			data: {
				category: input.category,
				event: input.event,
				actorType: input.actorType,
				actorId: input.actorId ?? null,
				actorLabel: input.actorLabel ?? null,
				subjectType: input.subjectType ?? null,
				subjectId: input.subjectId ?? null,
				clientIp: input.clientIp ?? null,
				metadata: metadata === null ? undefined : (metadata as unknown as Prisma.InputJsonValue),
			},
		});
	}
}
