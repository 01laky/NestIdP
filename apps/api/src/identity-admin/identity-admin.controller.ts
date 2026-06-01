import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
	IdentityGroupListResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { ParseCuidPipe } from '../common/parse-cuid.pipe';
import { IdentityAdminService } from './identity-admin.service';

@Controller('api/admin/identity')
@UseGuards(AdminAuthGuard)
export class IdentityAdminController {
	constructor(private readonly identityAdminService: IdentityAdminService) {}

	@Get('users')
	listUsers(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('search') search?: string,
	): Promise<IdentityUserListResponseDto> {
		return this.identityAdminService.listUsers(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
			search,
		);
	}

	@Get('users/:id')
	getUser(@Param('id', ParseCuidPipe) id: string): Promise<IdentityUserDetailResponseDto> {
		return this.identityAdminService.getUserById(id);
	}

	@Get('groups')
	listGroups(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
	): Promise<IdentityGroupListResponseDto> {
		return this.identityAdminService.listGroups(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
		);
	}

	@Get('roles')
	listRoles(
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
	): Promise<IdentityRoleListResponseDto> {
		return this.identityAdminService.listRoles(
			limit !== undefined ? Number(limit) : undefined,
			offset !== undefined ? Number(offset) : undefined,
		);
	}
}
