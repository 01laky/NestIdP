import type {
	AdminChangePasswordRequestDto,
	AdminChangePasswordResponseDto,
	AdminLoginRequestDto,
	AdminLoginResponseDto,
	AdminLogoutResponseDto,
	AdminMeResponseDto,
	AdminUserPublicDto,
	CreateAdminUserRequestDto,
	DeleteAdminUserResponseDto,
	UnlockAccountResponseDto,
	UpdateAdminUserRequestDto,
} from '@nestidp/shared';
import { ADMIN_USERS_API_PATH } from '@nestidp/shared';
import { adminFetch, setCsrfToken } from './core';

export function loginAdmin(body: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
	return adminFetch<AdminLoginResponseDto>('/api/admin/auth/login', {
		method: 'POST',
		body: JSON.stringify(body),
	}).then((response) => {
		setCsrfToken(response.csrfToken);
		return response;
	});
}

export function logoutAdmin(): Promise<AdminLogoutResponseDto> {
	return adminFetch<AdminLogoutResponseDto>('/api/admin/auth/logout', {
		method: 'POST',
	}).finally(() => {
		setCsrfToken(null);
	});
}

export function getAdminMe(): Promise<AdminMeResponseDto> {
	return adminFetch<AdminMeResponseDto>('/api/admin/auth/me').then((response) => {
		setCsrfToken(response.csrfToken);
		return response;
	});
}

export function listAdminUsers(): Promise<AdminUserPublicDto[]> {
	return adminFetch<AdminUserPublicDto[]>(ADMIN_USERS_API_PATH);
}

export function createAdminUser(body: CreateAdminUserRequestDto): Promise<AdminUserPublicDto> {
	return adminFetch<AdminUserPublicDto>(ADMIN_USERS_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateAdminUser(
	id: string,
	body: UpdateAdminUserRequestDto,
): Promise<AdminUserPublicDto> {
	return adminFetch<AdminUserPublicDto>(`${ADMIN_USERS_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteAdminUser(id: string): Promise<DeleteAdminUserResponseDto> {
	return adminFetch<DeleteAdminUserResponseDto>(`${ADMIN_USERS_API_PATH}/${id}`, {
		method: 'DELETE',
	});
}

export function unlockAdminUser(id: string): Promise<UnlockAccountResponseDto> {
	return adminFetch<UnlockAccountResponseDto>(`${ADMIN_USERS_API_PATH}/${id}/unlock`, {
		method: 'POST',
	});
}

export function changeAdminPassword(
	body: AdminChangePasswordRequestDto,
): Promise<AdminChangePasswordResponseDto> {
	return adminFetch<AdminChangePasswordResponseDto>('/api/admin/auth/change-password', {
		method: 'POST',
		body: JSON.stringify(body),
	});
}
