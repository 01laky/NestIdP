import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
	AUDIT_EXPORT_MAX_ROWS,
	type AuditEventExportJsonResponseDto,
	type AuditEventListResponseDto,
} from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { toAuditEventDto } from '../mappers/audit.mapper';
import type {
	ExportAuditEventsQueryDto,
	ListAuditEventsQueryDto,
} from '../dto/list-audit-events.query.dto';

@Injectable()
export class AuditQueryService {
	constructor(private readonly prisma: PrismaService) {}

	async list(query: ListAuditEventsQueryDto): Promise<AuditEventListResponseDto> {
		const limit = query.limit ?? 50;
		const offset = query.offset ?? 0;
		const where = this.buildWhere(query);

		const [rows, total] = await Promise.all([
			this.prisma.auditEvent.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				take: limit,
				skip: offset,
			}),
			this.prisma.auditEvent.count({ where }),
		]);

		return {
			items: rows.map(toAuditEventDto),
			total,
			limit,
			offset,
		};
	}

	async exportJson(query: ExportAuditEventsQueryDto): Promise<AuditEventExportJsonResponseDto> {
		const where = this.buildWhere(query);
		const rows = await this.prisma.auditEvent.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			take: AUDIT_EXPORT_MAX_ROWS,
		});

		return {
			exportedAt: new Date().toISOString(),
			filters: {
				category: query.category,
				event: query.event,
				since: query.since,
				until: query.until,
			},
			items: rows.map(toAuditEventDto),
			truncated: rows.length >= AUDIT_EXPORT_MAX_ROWS,
		};
	}

	exportCsv(query: ExportAuditEventsQueryDto): Promise<string> {
		return this.exportJson(query).then((body) => this.jsonToCsv(body.items));
	}

	private buildWhere(query: ListAuditEventsQueryDto): Prisma.AuditEventWhereInput {
		const where: Prisma.AuditEventWhereInput = {};
		if (query.category) {
			where.category = query.category;
		}
		if (query.event) {
			where.event = query.event;
		}
		if (query.since || query.until) {
			where.createdAt = {};
			if (query.since) {
				where.createdAt.gte = new Date(query.since);
			}
			if (query.until) {
				where.createdAt.lte = new Date(query.until);
			}
		}
		return where;
	}

	private jsonToCsv(items: AuditEventListResponseDto['items']): string {
		const header =
			'id,createdAt,category,event,actorType,actorLabel,subjectType,subjectId,clientIp,metadata';
		const lines = items.map((row) => {
			const metadata = row.metadata ? JSON.stringify(row.metadata) : '';
			return [
				escapeCsvCell(row.id),
				escapeCsvCell(row.createdAt),
				escapeCsvCell(row.category),
				escapeCsvCell(row.event),
				escapeCsvCell(row.actorType),
				escapeCsvCell(row.actorLabel ?? ''),
				escapeCsvCell(row.subjectType ?? ''),
				escapeCsvCell(row.subjectId ?? ''),
				escapeCsvCell(row.clientIp ?? ''),
				escapeCsvCell(metadata),
			].join(',');
		});
		return [header, ...lines].join('\n');
	}
}

/**
 * Quote a CSV cell AND neutralise spreadsheet formula-injection (§5.A11). Audit fields can contain
 * attacker-influenced data (e.g. a username chosen at login); a value starting with `=`, `+`, `-`, `@`,
 * tab or CR is interpreted as a formula by Excel/Sheets. Prefix such values with a single quote so the
 * cell is treated as text. The quote prefix is applied before the standard `"`-doubling/quoting.
 */
export function escapeCsvCell(value: string): string {
	const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${neutralised.replace(/"/g, '""')}"`;
}
