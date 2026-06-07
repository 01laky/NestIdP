import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type {
	ConnectExternalDbResponseDto,
	ExternalDbPreviewResponseDto,
	ExternalDbStatusResponseDto,
	TestExternalDbResponseDto,
} from '@nestidp/shared';
import { AdminAuthenticatedRequest } from '../../../admin-auth/admin-auth.types';
import { AdminAuthGuard } from '../../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../../admin-auth/guards/admin-csrf.guard';
import { ConnectExternalDbBodyDto, DisconnectExternalDbBodyDto, TestExternalDbBodyDto } from './external-identity-db.dto';
import { ExternalIdentityDatabaseService } from './external-identity-database.service';

const bodyPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller('api/admin/identity-database')
@UseGuards(AdminAuthGuard)
export class ExternalIdentityDatabaseController {
	constructor(private readonly service: ExternalIdentityDatabaseService) {}

	@Get()
	getStatus(): Promise<ExternalDbStatusResponseDto> {
		return this.service.getStatus();
	}

	@Post('test')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	test(@Body(bodyPipe) body: TestExternalDbBodyDto): Promise<TestExternalDbResponseDto> {
		return this.service.testConnection(body);
	}

	@Post('preview')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	preview(@Body(bodyPipe) body: ConnectExternalDbBodyDto): Promise<ExternalDbPreviewResponseDto> {
		return this.service.preview(body);
	}

	@Post()
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	connect(
		@Body(bodyPipe) body: ConnectExternalDbBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<ConnectExternalDbResponseDto> {
		return this.service.connect(body, { id: req.adminUser?.id, label: req.adminUser?.username });
	}

	@Post('resync')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	resync(@Req() req: AdminAuthenticatedRequest): Promise<ExternalDbStatusResponseDto> {
		return this.service.resync({ id: req.adminUser?.id, label: req.adminUser?.username });
	}

	@Delete()
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	disconnect(
		@Body(bodyPipe) body: DisconnectExternalDbBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<ExternalDbStatusResponseDto> {
		return this.service.disconnect(body, { id: req.adminUser?.id, label: req.adminUser?.username });
	}
}
