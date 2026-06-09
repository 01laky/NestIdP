import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Optional,
	Param,
	Post,
	Query,
	Req,
	ServiceUnavailableException,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import {
	SAML_SESSIONS_API_PATH,
	type ProcessBackchannelResponseDto,
	type ResendBackchannelLogoutResponseDto,
	type SamlBackchannelQueueHealthDto,
	type SamlSsoSessionListResponseDto,
	type SamlSsoSessionStatusFilter,
	type TerminateAllSamlSessionsResponseDto,
	type TerminateSamlSessionResponseDto,
	type TerminateSamlSessionsBulkResponseDto,
	type TerminateSamlSessionsByUserResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import type { AdminAuthenticatedRequest } from '../../admin-auth/admin-auth.types';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { LogoutPropagationService } from '../../saml/services/logout-propagation.service';
import { TerminateBulkBodyDto } from '../dto/terminate-bulk.dto';
import { TerminateByUserBodyDto } from '../dto/terminate-by-user.dto';
import { SamlSsoSessionService } from '../services/saml-sso-session.service';

@Controller(SAML_SESSIONS_API_PATH)
@UseGuards(AdminAuthGuard)
export class SamlSessionsController {
	constructor(
		private readonly sessions: SamlSsoSessionService,
		// @Global BackchannelLogoutModule provides this in production; @Optional so unit/integration
		// modules that don't import it still resolve the controller (Prompt 36).
		@Optional() private readonly propagation?: LogoutPropagationService,
	) {}

	@Get()
	list(
		@Query('status') status?: string,
		@Query('spConnectionId') spConnectionId?: string,
		@Query('apiConnectionId') apiConnectionId?: string,
		@Query('q') q?: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	): Promise<SamlSsoSessionListResponseDto> {
		return this.sessions.listForAdmin({
			status: this.normalizeStatus(status),
			spConnectionId: spConnectionId && spConnectionId.length > 0 ? spConnectionId : undefined,
			apiConnectionId: apiConnectionId && apiConnectionId.length > 0 ? apiConnectionId : undefined,
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

	@Post('terminate')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async terminateBulk(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: TerminateBulkBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<TerminateSamlSessionsBulkResponseDto> {
		const { results, terminatedCount } = await this.sessions.terminateBulk(
			body.ids,
			req.adminUser?.id,
		);
		return { ok: true, results, terminatedCount };
	}

	@Post('terminate-all')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async terminateAll(
		@Req() req: AdminAuthenticatedRequest,
	): Promise<TerminateAllSamlSessionsResponseDto> {
		const terminatedCount = await this.sessions.terminateAllActive(req.adminUser?.id);
		return { ok: true, terminatedCount };
	}

	@Post(':id/resend-backchannel/:spConnectionId')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async resendBackchannel(
		@Param('id', ParseCuidPipe) id: string,
		@Param('spConnectionId', ParseCuidPipe) spConnectionId: string,
	): Promise<ResendBackchannelLogoutResponseDto> {
		if (!this.propagation) {
			throw new ServiceUnavailableException('Back-channel logout not available');
		}
		await this.propagation.resend(id, spConnectionId);
		return { ok: true, ssoSessionId: id, spConnectionId };
	}

	@Post('process-backchannel')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async processBackchannel(): Promise<ProcessBackchannelResponseDto> {
		const processed = this.propagation ? await this.propagation.processDue() : 0;
		return { ok: true, processed };
	}

	@Get('backchannel-health')
	backchannelHealth(): Promise<SamlBackchannelQueueHealthDto> {
		return this.sessions.backchannelQueueHealth();
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
