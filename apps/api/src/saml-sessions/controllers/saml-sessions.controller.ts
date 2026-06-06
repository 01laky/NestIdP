import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Post,
	Query,
	Req,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import {
	SAML_SESSIONS_API_PATH,
	type SamlSsoSessionListResponseDto,
	type SamlSsoSessionStatusFilter,
	type TerminateSamlSessionResponseDto,
	type TerminateSamlSessionsByUserResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import type { AdminAuthenticatedRequest } from '../../admin-auth/admin-auth.types';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { TerminateByUserBodyDto } from '../dto/terminate-by-user.dto';
import { SamlSsoSessionService } from '../services/saml-sso-session.service';

@Controller(SAML_SESSIONS_API_PATH)
@UseGuards(AdminAuthGuard)
export class SamlSessionsController {
	constructor(private readonly sessions: SamlSsoSessionService) {}

	@Get()
	list(
		@Query('status') status?: string,
		@Query('spConnectionId') spConnectionId?: string,
		@Query('q') q?: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	): Promise<SamlSsoSessionListResponseDto> {
		return this.sessions.listForAdmin({
			status: this.normalizeStatus(status),
			spConnectionId: spConnectionId && spConnectionId.length > 0 ? spConnectionId : undefined,
			q: q && q.length > 0 ? q : undefined,
			page: this.toPositiveInt(page),
			pageSize: this.toPositiveInt(pageSize),
		});
	}

	@Post(':id/terminate')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async terminate(
		@Param('id', ParseCuidPipe) id: string,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<TerminateSamlSessionResponseDto> {
		const result = await this.sessions.terminate(id, 'admin_action', req.adminUser?.id);
		return { ok: true, id, alreadyTerminated: result.alreadyTerminated };
	}

	@Post('terminate-by-user')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async terminateByUser(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: TerminateByUserBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<TerminateSamlSessionsByUserResponseDto> {
		const terminatedCount = await this.sessions.terminateAllForUser(
			body.userId,
			'admin_action',
			req.adminUser?.id,
		);
		return { ok: true, userId: body.userId, terminatedCount };
	}

	private normalizeStatus(value?: string): SamlSsoSessionStatusFilter {
		if (value === 'terminated' || value === 'all') {
			return value;
		}
		return 'active';
	}

	private toPositiveInt(value?: string): number | undefined {
		if (value == null) {
			return undefined;
		}
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
}
