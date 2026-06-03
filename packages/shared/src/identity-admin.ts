import { API_CONNECTION_ROUTE_PREFIX } from './connections.js';

export const IDENTITY_USERS_API_PATH = '/api/admin/identity/users';
export const IDENTITY_GROUPS_API_PATH = '/api/admin/identity/groups';
export const IDENTITY_ROLES_API_PATH = '/api/admin/identity/roles';
export const IDENTITY_ROUTE_PREFIX = '/admin/identity';

export const LOCAL_DIRECTORY_CONNECTION_NAME = 'Local directory';
export const LOCAL_DIRECTORY_BASE_URL = 'https://local.nestidp/manual';

export type IdentityOriginLiteral = 'manual' | 'synced';

export const IDENTITY_USER_NEW_ROUTE = `${IDENTITY_ROUTE_PREFIX}/users/new`;
export const IDENTITY_GROUP_NEW_ROUTE = `${IDENTITY_ROUTE_PREFIX}/groups/new`;
export const IDENTITY_ROLE_NEW_ROUTE = `${IDENTITY_ROUTE_PREFIX}/roles/new`;

export function identityUserEditRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/users/${id}/edit`;
}

export function identityUserDetailRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/users/${id}`;
}

export function identityGroupDetailRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/groups/${id}`;
}

export function identityGroupEditRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/groups/${id}/edit`;
}

export function identityRoleDetailRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/roles/${id}`;
}

export function identityRoleEditRoute(id: string): string {
	return `${IDENTITY_ROUTE_PREFIX}/roles/${id}/edit`;
}

export interface IdentityUserListItemDto {
	id: string;
	username: string;
	email: string | null;
	displayName: string | null;
	active: boolean;
	externalId: string;
	apiConnectionId: string;
	origin: IdentityOriginLiteral;
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
	origin: IdentityOriginLiteral;
	memberCount?: number;
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
	origin: IdentityOriginLiteral;
	memberCount?: number;
}

export interface IdentityRoleListResponseDto {
	items: IdentityRoleListItemDto[];
	total: number;
}

export interface IdentityUserSourceDto {
	kind: 'local_directory' | 'api_connection';
	label: string;
	apiConnectionId: string;
	apiConnectionRoute: string | null;
}

export interface IdentityAuditSummaryDto {
	id: string;
	event: string;
	createdAt: string;
	actorLabel: string | null;
}

export interface IdentityUserDetailResponseDto {
	user: IdentityUserListItemDto;
	groups: Array<{ id: string; name: string; origin?: IdentityOriginLiteral }>;
	roles: Array<{ id: string; name: string; origin?: IdentityOriginLiteral }>;
	source: IdentityUserSourceDto;
	recentAudit?: IdentityAuditSummaryDto[];
}

export interface IdentityGroupMemberDto {
	id: string;
	username: string;
	origin: IdentityOriginLiteral;
}

export interface IdentityGroupDetailResponseDto {
	group: IdentityGroupListItemDto;
	members: IdentityGroupMemberDto[];
	memberCount: number;
}

export interface IdentityRoleDetailResponseDto {
	role: IdentityRoleListItemDto;
	members: IdentityGroupMemberDto[];
	memberCount: number;
}

export interface CreateManualIdentityUserDto {
	username: string;
	email?: string | null;
	displayName?: string | null;
	password: string;
	confirmPassword: string;
	active?: boolean;
	groupIds?: string[];
	roleIds?: string[];
}

export interface UpdateManualIdentityUserDto {
	username?: string;
	email?: string | null;
	displayName?: string | null;
	password?: string;
	active?: boolean;
	groupIds?: string[];
	roleIds?: string[];
}

export interface CreateManualIdentityGroupDto {
	name: string;
}

export interface UpdateManualIdentityGroupDto {
	name: string;
}

export interface CreateManualIdentityRoleDto {
	name: string;
}

export interface UpdateManualIdentityRoleDto {
	name: string;
}

export function apiConnectionAdminRoute(id: string): string {
	return `${API_CONNECTION_ROUTE_PREFIX}/${id}`;
}
