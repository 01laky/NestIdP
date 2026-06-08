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
	API_CONNECTIONS_API_PATH,
	type ApiConnectionListResponseDto,
	type ApiConnectionResponseDto,
	type ApiConnectionTestResponseDto,
	type ApiConnectionTestTokenResponseDto,
	type DeleteApiConnectionResponseDto,
	type ProxyCheckResultDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { ApiConnectionTestService } from '../services/api-connection-test.service';
import { ApiConnectionsService } from '../services/api-connections.service';
import { CreateApiConnectionBodyDto } from '../dto/create-api-connection.dto';
import { UpdateApiConnectionBodyDto } from '../dto/update-api-connection.dto';

@Controller(API_CONNECTIONS_API_PATH)
@UseGuards(AdminAuthGuard)
export class ApiConnectionsController {
	constructor(
		private readonly apiConnectionsService: ApiConnectionsService,
		private readonly apiConnectionTestService: ApiConnectionTestService,
	) {}

	@Get()
	list(): Promise<ApiConnectionListResponseDto> {
		return this.apiConnectionsService.list();
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	create(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: CreateApiConnectionBodyDto,
	): Promise<ApiConnectionResponseDto> {
		return this.apiConnectionsService.create(body);
	}

	@Get(':id')
	getById(@Param('id', ParseCuidPipe) id: string): Promise<ApiConnectionResponseDto> {
		return this.apiConnectionsService.getById(id);
	}

	@Patch(':id')
	@UseGuards(AdminCsrfGuard)
	update(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateApiConnectionBodyDto,
	): Promise<ApiConnectionResponseDto> {
		return this.apiConnectionsService.update(id, body);
	}

	@Delete(':id')
	@UseGuards(AdminCsrfGuard)
	delete(@Param('id', ParseCuidPipe) id: string): Promise<DeleteApiConnectionResponseDto> {
		return this.apiConnectionsService.delete(id);
	}

	@Post(':id/test')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	test(@Param('id', ParseCuidPipe) id: string): Promise<ApiConnectionTestResponseDto> {
		return this.apiConnectionTestService.testConnection(id);
	}

	@Post(':id/test-token')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	testToken(@Param('id', ParseCuidPipe) id: string): Promise<ApiConnectionTestTokenResponseDto> {
		return this.apiConnectionTestService.testToken(id);
	}

	@Post(':id/test-proxy')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminCsrfGuard)
	testProxy(@Param('id', ParseCuidPipe) id: string): Promise<ProxyCheckResultDto> {
		return this.apiConnectionTestService.testProxy(id);
	}
}
