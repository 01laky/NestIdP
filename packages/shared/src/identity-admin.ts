export const IDENTITY_USERS_API_PATH = '/api/admin/identity/users';
export const IDENTITY_GROUPS_API_PATH = '/api/admin/identity/groups';
export const IDENTITY_ROLES_API_PATH = '/api/admin/identity/roles';
export const IDENTITY_ROUTE_PREFIX = '/admin/identity';

export interface IdentityUserListItemDto {
	id: string;
	username: string;
	email: string | null;
	displayName: string | null;
	active: boolean;
	externalId: string;
	apiConnectionId: string;
}

export interface IdentityUserListResponseDto {
	items: IdentityUserListItemDto[];
	total: number;
}

export interface IdentityGroupListItemDto {
	id: string;
	name: string;
	externalId: string;
	apiConnectionId: string;
}

export interface IdentityGroupListResponseDto {
	items: IdentityGroupListItemDto[];
	total: number;
}

export interface IdentityRoleListItemDto {
	id: string;
	name: string;
	externalId: string;
	apiConnectionId: string;
}

export interface IdentityRoleListResponseDto {
	items: IdentityRoleListItemDto[];
	total: number;
}

export interface IdentityUserDetailResponseDto {
	user: IdentityUserListItemDto;
	groups: Array<{ id: string; name: string }>;
	roles: Array<{ id: string; name: string }>;
}
