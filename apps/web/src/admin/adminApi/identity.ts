import type {
	CreateManualIdentityGroupDto,
	CreateManualIdentityRoleDto,
	CreateManualIdentityUserDto,
	IdentityGroupDetailResponseDto,
	IdentityGroupListResponseDto,
	IdentityRoleDetailResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
	UnlockAccountResponseDto,
	UpdateManualIdentityGroupDto,
	UpdateManualIdentityRoleDto,
	UpdateManualIdentityUserDto,
} from '@nestidp/shared';
import {
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_LIST_PAGE_SIZE,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_USERS_API_PATH,
} from '@nestidp/shared';
import { adminFetch, toQuery } from './core';

export function listIdentityUsers(
	params: {
		limit?: number;
		offset?: number;
		search?: string;
		origin?: string;
		apiConnectionId?: string;
	} = {},
): Promise<IdentityUserListResponseDto> {
	return adminFetch<IdentityUserListResponseDto>(
		`${IDENTITY_USERS_API_PATH}${toQuery({
			limit: params.limit ?? IDENTITY_LIST_PAGE_SIZE,
			offset: params.offset,
			search: params.search,
			origin: params.origin,
			apiConnectionId: params.apiConnectionId,
		})}`,
	);
}

export function getIdentityUser(
	id: string,
	params: { auditLimit?: number } = {},
): Promise<IdentityUserDetailResponseDto> {
	return adminFetch<IdentityUserDetailResponseDto>(
		`${IDENTITY_USERS_API_PATH}/${id}${toQuery(params)}`,
	);
}

export function createIdentityUser(
	body: CreateManualIdentityUserDto,
): Promise<IdentityUserDetailResponseDto> {
	return adminFetch<IdentityUserDetailResponseDto>(IDENTITY_USERS_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateIdentityUser(
	id: string,
	body: UpdateManualIdentityUserDto,
): Promise<IdentityUserDetailResponseDto> {
	return adminFetch<IdentityUserDetailResponseDto>(`${IDENTITY_USERS_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteIdentityUser(id: string): Promise<void> {
	return adminFetch<void>(`${IDENTITY_USERS_API_PATH}/${id}`, { method: 'DELETE' });
}

export function listIdentityGroups(
	params: { limit?: number; offset?: number; origin?: string; apiConnectionId?: string } = {},
): Promise<IdentityGroupListResponseDto> {
	return adminFetch<IdentityGroupListResponseDto>(
		`${IDENTITY_GROUPS_API_PATH}${toQuery({
			limit: params.limit ?? IDENTITY_LIST_PAGE_SIZE,
			offset: params.offset,
			origin: params.origin,
			apiConnectionId: params.apiConnectionId,
		})}`,
	);
}

export function getIdentityGroup(id: string): Promise<IdentityGroupDetailResponseDto> {
	return adminFetch<IdentityGroupDetailResponseDto>(`${IDENTITY_GROUPS_API_PATH}/${id}`);
}

export function createIdentityGroup(
	body: CreateManualIdentityGroupDto,
): Promise<IdentityGroupDetailResponseDto> {
	return adminFetch<IdentityGroupDetailResponseDto>(IDENTITY_GROUPS_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateIdentityGroup(
	id: string,
	body: UpdateManualIdentityGroupDto,
): Promise<IdentityGroupDetailResponseDto> {
	return adminFetch<IdentityGroupDetailResponseDto>(`${IDENTITY_GROUPS_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteIdentityGroup(id: string): Promise<void> {
	return adminFetch<void>(`${IDENTITY_GROUPS_API_PATH}/${id}`, { method: 'DELETE' });
}

export function listIdentityRoles(
	params: { limit?: number; offset?: number; origin?: string; apiConnectionId?: string } = {},
): Promise<IdentityRoleListResponseDto> {
	return adminFetch<IdentityRoleListResponseDto>(
		`${IDENTITY_ROLES_API_PATH}${toQuery({
			limit: params.limit ?? IDENTITY_LIST_PAGE_SIZE,
			offset: params.offset,
			origin: params.origin,
			apiConnectionId: params.apiConnectionId,
		})}`,
	);
}

export function getIdentityRole(id: string): Promise<IdentityRoleDetailResponseDto> {
	return adminFetch<IdentityRoleDetailResponseDto>(`${IDENTITY_ROLES_API_PATH}/${id}`);
}

export function createIdentityRole(
	body: CreateManualIdentityRoleDto,
): Promise<IdentityRoleDetailResponseDto> {
	return adminFetch<IdentityRoleDetailResponseDto>(IDENTITY_ROLES_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateIdentityRole(
	id: string,
	body: UpdateManualIdentityRoleDto,
): Promise<IdentityRoleDetailResponseDto> {
	return adminFetch<IdentityRoleDetailResponseDto>(`${IDENTITY_ROLES_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteIdentityRole(id: string): Promise<void> {
	return adminFetch<void>(`${IDENTITY_ROLES_API_PATH}/${id}`, { method: 'DELETE' });
}

export function unlockIdentityUser(id: string): Promise<UnlockAccountResponseDto> {
	return adminFetch<UnlockAccountResponseDto>(`${IDENTITY_USERS_API_PATH}/${id}/unlock`, {
		method: 'POST',
	});
}
