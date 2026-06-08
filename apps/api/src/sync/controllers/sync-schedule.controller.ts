import { Body, Controller, Get, Param, Patch, UseGuards, ValidationPipe } from '@nestjs/common';
import {
	SYNC_API_PATH,
	type ScheduleResponseDto,
	type SchedulesOverviewResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { SyncScheduleService } from '../services/sync-schedule.service';
import { UpdateScheduleBodyDto } from '../dto/update-schedule.dto';

@Controller(SYNC_API_PATH)
@UseGuards(AdminAuthGuard)
export class SyncScheduleController {
	constructor(private readonly scheduleService: SyncScheduleService) {}

	@Get('schedules/overview')
	getOverview(): Promise<SchedulesOverviewResponseDto> {
		return this.scheduleService.getOverview();
	}

	@Get(':connectionId/schedule')
	getSchedule(
		@Param('connectionId', ParseCuidPipe) connectionId: string,
	): Promise<ScheduleResponseDto> {
		return this.scheduleService.getSchedule(connectionId);
	}

	@Patch(':connectionId/schedule')
	@UseGuards(AdminCsrfGuard)
	updateSchedule(
		@Param('connectionId', ParseCuidPipe) connectionId: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateScheduleBodyDto,
	): Promise<ScheduleResponseDto> {
		return this.scheduleService.updateSchedule(connectionId, body);
	}
}
