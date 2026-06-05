import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import {
	SP_CONNECTIONS_API_PATH,
	type DeleteSpConnectionResponseDto,
	type SpConnectionListResponseDto,
	type SpConnectionPublicDto,
	type SpConnectionResponseDto,
	type SpConnectionTestAcsResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { SpConnectionTestAcsService } from '../services/sp-connection-test-acs.service';
import { CreateSpConnectionBodyDto } from '../dto/create-sp-connection.dto';
import { SpConnectionsService } from '../services/sp-connections.service';
import { UpdateSpConnectionBodyDto } from '../dto/update-sp-connection.dto';

@Controller(SP_CONNECTIONS_API_PATH)
@UseGuards(AdminAuthGuard)
export class SpConnectionsController {
	constructor(
		private readonly spConnectionsService: SpConnectionsService,
		private readonly testAcsService: SpConnectionTestAcsService,
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
}
