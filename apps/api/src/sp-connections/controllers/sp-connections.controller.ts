import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Optional,
	Param,
	Patch,
	Post,
	Query,
	ServiceUnavailableException,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import {
	SP_CONNECTIONS_API_PATH,
	type DeleteSpConnectionResponseDto,
	type ParseSloFromMetadataResponseDto,
	type ProbeSpSigningRequestDto,
	type ProbeSpSigningResponseDto,
	type SpConnectionListResponseDto,
	type SpConnectionPublicDto,
	type SpConnectionResponseDto,
	type SpConnectionTestAcsResponseDto,
	type SpConnectionTestSsoUrlResponseDto,
	type TestSpBackchannelSloResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { LogoutPropagationService } from '../../saml/services/logout-propagation.service';
import { SpConnectionProbeSigningService } from '../services/sp-connection-probe-signing.service';
import { SpConnectionTestAcsService } from '../services/sp-connection-test-acs.service';
import { SpConnectionTestSsoUrlService } from '../services/sp-connection-test-sso-url.service';
import { ProbeSpSigningBodyDto } from '../dto/probe-sp-signing.dto';
import { ParseSloMetadataBodyDto } from '../dto/parse-slo-metadata.dto';
import { CreateSpConnectionBodyDto } from '../dto/create-sp-connection.dto';
import { SpConnectionsService } from '../services/sp-connections.service';
import { UpdateSpConnectionBodyDto } from '../dto/update-sp-connection.dto';

@Controller(SP_CONNECTIONS_API_PATH)
@UseGuards(AdminAuthGuard)
export class SpConnectionsController {
	constructor(
		private readonly spConnectionsService: SpConnectionsService,
		private readonly testAcsService: SpConnectionTestAcsService,
		private readonly testSsoUrlService: SpConnectionTestSsoUrlService,
		private readonly probeSigningService: SpConnectionProbeSigningService,
		// @Global BackchannelLogoutModule provides this in production; @Optional so modules that don't
		// import it still resolve the controller (Prompt 36, item S).
		@Optional() private readonly propagation?: LogoutPropagationService,
	) {}

	@Get()
	list(): Promise<SpConnectionListResponseDto> {
		return this.spConnectionsService.list();
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	create(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: CreateSpConnectionBodyDto,
	): Promise<SpConnectionResponseDto> {
		return this.spConnectionsService.create(body);
	}

	@Get(':id')
	getById(@Param('id', ParseCuidPipe) id: string): Promise<SpConnectionPublicDto> {
		return this.spConnectionsService.getById(id);
	}

	@Patch(':id')
	@UseGuards(AdminCsrfGuard)
	update(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateSpConnectionBodyDto,
	): Promise<SpConnectionResponseDto> {
		return this.spConnectionsService.update(id, body);
	}

	@Delete(':id')
	@UseGuards(AdminCsrfGuard)
	delete(@Param('id', ParseCuidPipe) id: string): Promise<DeleteSpConnectionResponseDto> {
		return this.spConnectionsService.delete(id);
	}

	@Post(':id/test-acs')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	testAcs(@Param('id', ParseCuidPipe) id: string): Promise<SpConnectionTestAcsResponseDto> {
		return this.testAcsService.testAcs(id);
	}

	@Get(':id/test-sso-url')
	testSsoUrl(
		@Param('id', ParseCuidPipe) id: string,
		@Query('signed') signed?: string,
		@Query('encrypted') encrypted?: string,
		@Query('relayState') relayState?: string,
	): Promise<SpConnectionTestSsoUrlResponseDto> {
		return this.testSsoUrlService.buildTestSsoUrl(id, {
			signed: signed === 'true',
			encrypted: encrypted === 'true',
			relayState,
		});
	}

	@Post('parse-slo-from-metadata')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	parseSloFromMetadata(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ParseSloMetadataBodyDto,
	): ParseSloFromMetadataResponseDto {
		return this.spConnectionsService.parseSloFromMetadata(body.metadataXml);
	}

	@Post(':id/probe-sp-signing')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	probeSpSigning(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ProbeSpSigningBodyDto,
	): Promise<ProbeSpSigningResponseDto> {
		return this.probeSigningService.probeSigning(id, body as ProbeSpSigningRequestDto);
	}

	@Post(':id/test-backchannel')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	async testBackchannel(
		@Param('id', ParseCuidPipe) id: string,
	): Promise<TestSpBackchannelSloResponseDto> {
		if (!this.propagation) {
			throw new ServiceUnavailableException('Back-channel logout not available');
		}
		return this.propagation.probe(id);
	}
}
