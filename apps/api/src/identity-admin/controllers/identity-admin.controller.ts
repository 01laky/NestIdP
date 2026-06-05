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
	Query,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import type {
	IdentityGroupDetailResponseDto,
	IdentityGroupListResponseDto,
	IdentityRoleDetailResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { CreateManualIdentityUserBodyDto } from '../dto/create-manual-user.dto';
import { ManualNameBodyDto } from '../dto/manual-name.dto';
import { IdentityAdminService } from '../services/identity-admin.service';
import { UpdateManualIdentityUserBodyDto } from '../dto/update-manual-user.dto';

@Controller('api/admin/identity')
@UseGuards(AdminAuthGuard)
export class IdentityAdminController {
	constructor(private readonly identityAdminService: IdentityAdminService) {}

	@Get('users')
	listUsers(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('search') search?: string,
		@Query('origin') origin?: string,
	): Promise<IdentityUserListResponseDto> {
		return this.identityAdminService.listUsers(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
			search,
			origin,
		);
	}

	@Post('users')
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	createUser(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: CreateManualIdentityUserBodyDto,
	): Promise<IdentityUserDetailResponseDto> {
		return this.identityAdminService.createUser(body);
	}

	@Get('users/:id')
	getUser(
		@Param('id', ParseCuidPipe) id: string,
		@Query('auditLimit') auditLimit?: string,
	): Promise<IdentityUserDetailResponseDto> {
		return this.identityAdminService.getUserById(
			id,
			auditLimit !== undefined ? Number(auditLimit) : undefined,
		);
	}

	@Patch('users/:id')
	@UseGuards(AdminCsrfGuard)
	updateUser(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateManualIdentityUserBodyDto,
	): Promise<IdentityUserDetailResponseDto> {
		return this.identityAdminService.updateUser(id, body);
	}

	@Delete('users/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@UseGuards(AdminCsrfGuard)
	async deleteUser(@Param('id', ParseCuidPipe) id: string): Promise<void> {
		await this.identityAdminService.deleteUser(id);
	}

	@Get('groups')
	listGroups(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('origin') origin?: string,
	): Promise<IdentityGroupListResponseDto> {
		return this.identityAdminService.listGroups(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
			origin,
		);
	}

	@Post('groups')
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	createGroup(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ManualNameBodyDto,
	): Promise<IdentityGroupDetailResponseDto> {
		return this.identityAdminService.createGroup(body);
	}

	@Get('groups/:id')
	getGroup(@Param('id', ParseCuidPipe) id: string): Promise<IdentityGroupDetailResponseDto> {
		return this.identityAdminService.getGroupById(id);
	}

	@Patch('groups/:id')
	@UseGuards(AdminCsrfGuard)
	updateGroup(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ManualNameBodyDto,
	): Promise<IdentityGroupDetailResponseDto> {
		return this.identityAdminService.updateGroup(id, body);
	}

	@Delete('groups/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@UseGuards(AdminCsrfGuard)
	async deleteGroup(@Param('id', ParseCuidPipe) id: string): Promise<void> {
		await this.identityAdminService.deleteGroup(id);
	}

	@Get('roles')
	listRoles(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('origin') origin?: string,
	): Promise<IdentityRoleListResponseDto> {
		return this.identityAdminService.listRoles(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
			origin,
		);
	}

	@Post('roles')
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	createRole(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ManualNameBodyDto,
	): Promise<IdentityRoleDetailResponseDto> {
		return this.identityAdminService.createRole(body);
	}

	@Get('roles/:id')
	getRole(@Param('id', ParseCuidPipe) id: string): Promise<IdentityRoleDetailResponseDto> {
		return this.identityAdminService.getRoleById(id);
	}

	@Patch('roles/:id')
	@UseGuards(AdminCsrfGuard)
	updateRole(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: ManualNameBodyDto,
	): Promise<IdentityRoleDetailResponseDto> {
		return this.identityAdminService.updateRole(id, body);
	}

	@Delete('roles/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@UseGuards(AdminCsrfGuard)
	async deleteRole(@Param('id', ParseCuidPipe) id: string): Promise<void> {
		await this.identityAdminService.deleteRole(id);
	}
}
