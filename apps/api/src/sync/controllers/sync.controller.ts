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
	isSyncTriggerSource,
	type SyncAllResponseDto,
	type SyncLogListResponseDto,
	type SyncLogResponseDto,
	type SyncStatusResponseDto,
	type SyncTriggerSource,
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
		@Query('source') source?: string,
	): Promise<SyncLogListResponseDto> {
		const safeLimit = Math.min(Math.max(limit, 1), 100);
		const triggerSource: SyncTriggerSource | undefined =
			source !== undefined && isSyncTriggerSource(source) ? source : undefined;
		return this.syncService.listSyncLogs(connectionId, safeLimit, triggerSource);
	}

	/** "Sync all sources" (Prompt 37). Declared before `:connectionId` so the literal route wins. */
	@Post('all')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	syncAll(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: TriggerSyncBodyDto,
		@Query('dryRun') dryRunQuery: string | undefined,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<SyncAllResponseDto> {
		return this.syncService.syncAll({
			dryRun: body.dryRun === true || dryRunQuery === 'true',
			adminId: req.adminUser?.id,
			adminUsername: req.adminUser?.username,
		});
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
