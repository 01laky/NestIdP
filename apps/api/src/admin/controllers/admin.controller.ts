import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AdminDashboardResponseDto } from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminDashboardService } from '../services/admin-dashboard.service';

@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
	constructor(private readonly adminDashboardService: AdminDashboardService) {}

	@Get()
	getDashboard(): Promise<AdminDashboardResponseDto> {
		return this.adminDashboardService.getDashboard();
	}
}
