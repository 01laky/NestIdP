export const ADMIN_USERS_API_PATH = '/api/admin/admin-users';

export const ADMIN_USERS_ROUTE_PREFIX = '/admin/settings/admins';

export interface AdminUserPublicDto {
	id: string;
	username: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateAdminUserRequestDto {
	username: string;
	password: string;
}

export interface UpdateAdminUserRequestDto {
	password: string;
}

export interface DeleteAdminUserResponseDto {
	ok: true;
	id: string;
}
