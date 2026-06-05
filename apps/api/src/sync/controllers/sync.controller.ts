import {
	Body,
	Controller,
	DefaultValuePipe,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseIntPipe,
	Post,
	Query,
	Req,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import { AdminAuthenticatedRequest } from '../../admin-auth/admin-auth.types';
import {
	SYNC_API_PATH,
	type SyncLogListResponseDto,
	type SyncLogResponseDto,
	type SyncStatusResponseDto,
	type TriggerSyncResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { SyncService } from '../services/sync.service';
import { TriggerSyncBodyDto } from '../dto/trigger-sync.dto';

@Controller(SYNC_API_PATH)
@UseGuards(AdminAuthGuard)
export class SyncController {
	constructor(private readonly syncService: SyncService) {}

	@Get('logs/:syncLogId')
	getSyncLog(@Param('syncLogId', ParseCuidPipe) syncLogId: string): Promise<SyncLogResponseDto> {
		return this.syncService.getSyncLog(syncLogId);
	}

	@Get(':connectionId/status')
	getStatus(
		@Param('connectionId', ParseCuidPipe) connectionId: string,
	): Promise<SyncStatusResponseDto> {
		return this.syncService.getSyncStatus(connectionId);
	}

	@Get(':connectionId/logs')
	listLogs(
		@Param('connectionId', ParseCuidPipe) connectionId: string,
		@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
	): Promise<SyncLogListResponseDto> {
		const safeLimit = Math.min(Math.max(limit, 1), 100);
		return this.syncService.listSyncLogs(connectionId, safeLimit);
	}

	@Post(':connectionId')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	triggerSync(
		@Param('connectionId', ParseCuidPipe) connectionId: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: TriggerSyncBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<TriggerSyncResponseDto> {
		return this.syncService.triggerSync(connectionId, {
			dryRun: body.dryRun,
			adminId: req.adminUser?.id,
			adminUsername: req.adminUser?.username,
		});
	}
}
