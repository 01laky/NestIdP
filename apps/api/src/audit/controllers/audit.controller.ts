import { Controller, Get, Query, Res, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AUDIT_EVENTS_API_PATH } from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AuditQueryService } from '../services/audit-query.service';
import {
	ExportAuditEventsQueryDto,
	ListAuditEventsQueryDto,
} from '../dto/list-audit-events.query.dto';

@Controller(AUDIT_EVENTS_API_PATH)
@UseGuards(AdminAuthGuard)
export class AuditController {
	constructor(private readonly auditQueryService: AuditQueryService) {}

	@Get()
	list(
		@Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
		query: ListAuditEventsQueryDto,
	) {
		return this.auditQueryService.list(query);
	}

	@Get('export')
	async export(
		@Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
		query: ExportAuditEventsQueryDto,
		@Res() res: Response,
	): Promise<void> {
		const format = query.format ?? 'json';
		if (format === 'csv') {
			const csv = await this.auditQueryService.exportCsv(query);
			const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
			res.setHeader('Content-Type', 'text/csv; charset=utf-8');
			res.setHeader('Content-Disposition', `attachment; filename="nestidp-audit-${stamp}.csv"`);
			res.status(200).send(csv);
			return;
		}

		const body = await this.auditQueryService.exportJson(query);
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.status(200).json(body);
	}
}
