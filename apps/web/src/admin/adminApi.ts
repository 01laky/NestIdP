import type {
	AdminDashboardResponseDto,
	AdminChangePasswordRequestDto,
	AdminChangePasswordResponseDto,
	AdminLoginRequestDto,
	AdminLoginResponseDto,
	AdminLogoutResponseDto,
	AdminMeResponseDto,
	AdminUserPublicDto,
	AuditEventListResponseDto,
	CreateAdminUserRequestDto,
	DeleteAdminUserResponseDto,
	UpdateAdminUserRequestDto,
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	ApiConnectionTestResponseDto,
	ApiErrorResponseDto,
	CreateApiConnectionRequestDto,
	CreateSpConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	DeleteSpConnectionResponseDto,
	IdpMetadataPreviewResponseDto,
	IdpSettingsPublicDto,
	CreateManualIdentityGroupDto,
	CreateManualIdentityRoleDto,
	CreateManualIdentityUserDto,
	IdentityGroupDetailResponseDto,
	IdentityGroupListResponseDto,
	IdentityRoleDetailResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
	UpdateManualIdentityGroupDto,
	UpdateManualIdentityRoleDto,
	UpdateManualIdentityUserDto,
	SpConnectionPublicDto,
	SpConnectionResponseDto,
	SpConnectionTestAcsResponseDto,
	StartIdpCertRotationRequestDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	TriggerSyncRequestDto,
	TriggerSyncResponseDto,
	UpdateApiConnectionRequestDto,
	UpdateIdpSettingsRequestDto,
	UpdateSpConnectionRequestDto,
	UploadIdpSigningCertRequestDto,
} from '@nestidp/shared';
import type { IdpMetadataUrlResponseDto, SpConnectionListResponseDto } from '@nestidp/shared';
import {
	ADMIN_CSRF_HEADER_NAME,
	API_CONNECTIONS_API_PATH,
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_USERS_API_PATH,
	IDP_METADATA_URL_API_PATH,
	IDP_SETTINGS_API_PATH,
	ADMIN_USERS_API_PATH,
	AUDIT_EVENTS_API_PATH,
	SP_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
} from '@nestidp/shared';

export class AdminApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'AdminApiError';
	}
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
	csrfToken = token;
}

export function getCsrfToken(): string | null {
	return csrfToken;
}

function isMutatingMethod(method: string | undefined): boolean {
	const normalized = (method ?? 'GET').toUpperCase();
	return normalized === 'POST' || normalized === 'PATCH' || normalized === 'DELETE';
}

async function parseErrorResponse(response: Response): Promise<ApiErrorResponseDto> {
	try {
		const body = (await response.json()) as Partial<ApiErrorResponseDto>;
		return {
			statusCode: body.statusCode ?? response.status,
			message: body.message ?? response.statusText,
		};
	} catch {
		return {
			statusCode: response.status,
			message: response.statusText || 'Request failed',
		};
	}
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const method = init.method ?? 'GET';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(init.headers as Record<string, string> | undefined),
	};

	if (csrfToken && isMutatingMethod(method)) {
		headers[ADMIN_CSRF_HEADER_NAME] = csrfToken;
	}

	const response = await fetch(path, {
		...init,
		credentials: 'include',
		headers,
	});

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		throw new AdminApiError(error.statusCode, error.message);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

export function loginAdmin(body: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
	return adminFetch<AdminLoginResponseDto>('/api/admin/auth/login', {
		method: 'POST',
		body: JSON.stringify(body),
	}).then((response) => {
		csrfToken = response.csrfToken;
		return response;
	});
}

export function logoutAdmin(): Promise<AdminLogoutResponseDto> {
	return adminFetch<AdminLogoutResponseDto>('/api/admin/auth/logout', {
		method: 'POST',
	}).finally(() => {
		csrfToken = null;
	});
}

export function getAdminMe(): Promise<AdminMeResponseDto> {
	return adminFetch<AdminMeResponseDto>('/api/admin/auth/me').then((response) => {
		csrfToken = response.csrfToken;
		return response;
	});
}

export function listApiConnections(): Promise<ApiConnectionListResponseDto> {
	return adminFetch<ApiConnectionListResponseDto>(API_CONNECTIONS_API_PATH);
}

export function getApiConnection(id: string): Promise<ApiConnectionResponseDto> {
	return adminFetch<ApiConnectionResponseDto>(`${API_CONNECTIONS_API_PATH}/${id}`);
}

export function createApiConnection(
	body: CreateApiConnectionRequestDto,
): Promise<ApiConnectionResponseDto> {
	return adminFetch<ApiConnectionResponseDto>(API_CONNECTIONS_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateApiConnection(
	id: string,
	body: UpdateApiConnectionRequestDto,
): Promise<ApiConnectionResponseDto> {
	return adminFetch<ApiConnectionResponseDto>(`${API_CONNECTIONS_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteApiConnection(id: string): Promise<DeleteApiConnectionResponseDto> {
	return adminFetch<DeleteApiConnectionResponseDto>(`${API_CONNECTIONS_API_PATH}/${id}`, {
		method: 'DELETE',
	});
}

export function testApiConnection(id: string): Promise<ApiConnectionTestResponseDto> {
	return adminFetch<ApiConnectionTestResponseDto>(`${API_CONNECTIONS_API_PATH}/${id}/test`, {
		method: 'POST',
	});
}

export function triggerIdentitySync(
	connectionId: string,
	options: TriggerSyncRequestDto = {},
): Promise<TriggerSyncResponseDto> {
	return adminFetch<TriggerSyncResponseDto>(`${SYNC_API_PATH}/${connectionId}`, {
		method: 'POST',
		body: JSON.stringify(options),
	});
}

export function getSyncStatus(connectionId: string): Promise<SyncStatusResponseDto> {
	return adminFetch<SyncStatusResponseDto>(`${SYNC_API_PATH}/${connectionId}/status`);
}

export function listSyncLogs(
	connectionId: string,
	limit?: number,
): Promise<SyncLogListResponseDto> {
	const query = limit != null ? `?limit=${limit}` : '';
	return adminFetch<SyncLogListResponseDto>(`${SYNC_API_PATH}/${connectionId}/logs${query}`);
}

export function getSyncLog(syncLogId: string): Promise<SyncLogResponseDto> {
	return adminFetch<SyncLogResponseDto>(`${SYNC_API_PATH}/logs/${syncLogId}`);
}

export function listSpConnections(): Promise<SpConnectionListResponseDto> {
	return adminFetch<SpConnectionListResponseDto>(SP_CONNECTIONS_API_PATH);
}

export function getSpConnection(id: string): Promise<SpConnectionListResponseDto['items'][number]> {
	return adminFetch<SpConnectionListResponseDto['items'][number]>(
		`${SP_CONNECTIONS_API_PATH}/${id}`,
	);
}

export function getIdpMetadataUrl(): Promise<IdpMetadataUrlResponseDto> {
	return adminFetch<IdpMetadataUrlResponseDto>(IDP_METADATA_URL_API_PATH);
}

export function getAdminDashboard(): Promise<AdminDashboardResponseDto> {
	return adminFetch<AdminDashboardResponseDto>('/api/admin');
}

export function createSpConnection(
	body: CreateSpConnectionRequestDto,
): Promise<SpConnectionResponseDto> {
	return adminFetch<SpConnectionResponseDto>(SP_CONNECTIONS_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function updateSpConnection(
	id: string,
	body: UpdateSpConnectionRequestDto,
): Promise<SpConnectionResponseDto> {
	return adminFetch<SpConnectionResponseDto>(`${SP_CONNECTIONS_API_PATH}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function deleteSpConnection(id: string): Promise<DeleteSpConnectionResponseDto> {
	return adminFetch<DeleteSpConnectionResponseDto>(`${SP_CONNECTIONS_API_PATH}/${id}`, {
		method: 'DELETE',
	});
}

export function testSpConnectionAcs(id: string): Promise<SpConnectionTestAcsResponseDto> {
	return adminFetch<SpConnectionTestAcsResponseDto>(`${SP_CONNECTIONS_API_PATH}/${id}/test-acs`, {
		method: 'POST',
	});
}

function identityQuery(params: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') {
			query.set(key, String(value));
		}
	}
	return query.size > 0 ? `?${query.toString()}` : '';
}

export function listIdentityUsers(
	params: { limit?: number; offset?: number; search?: string; origin?: string } = {},
): Promise<IdentityUserListResponseDto> {
	return adminFetch<IdentityUserListResponseDto>(
		`${IDENTITY_USERS_API_PATH}${identityQuery(params)}`,
	);
}

export function getIdentityUser(
	id: string,
	params: { auditLimit?: number } = {},
): Promise<IdentityUserDetailResponseDto> {
	return adminFetch<IdentityUserDetailResponseDto>(
		`${IDENTITY_USERS_API_PATH}/${id}${identityQuery(params)}`,
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
	params: { limit?: number; offset?: number; origin?: string } = {},
): Promise<IdentityGroupListResponseDto> {
	return adminFetch<IdentityGroupListResponseDto>(
		`${IDENTITY_GROUPS_API_PATH}${identityQuery(params)}`,
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
	params: { limit?: number; offset?: number; origin?: string } = {},
): Promise<IdentityRoleListResponseDto> {
	return adminFetch<IdentityRoleListResponseDto>(
		`${IDENTITY_ROLES_API_PATH}${identityQuery(params)}`,
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

export function getIdpSettings(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(IDP_SETTINGS_API_PATH);
}

export function updateIdpSettings(
	body: UpdateIdpSettingsRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(IDP_SETTINGS_API_PATH, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function generateIdpSigningCert(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`, {
		method: 'POST',
	});
}

export function uploadIdpSigningCert(
	body: UploadIdpSigningCertRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function startIdpCertRotation(
	body: StartIdpCertRotationRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function completeIdpCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`,
		{
			method: 'POST',
		},
	);
}

export function cancelIdpCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`, {
		method: 'POST',
	});
}

export function getIdpMetadataPreview(): Promise<IdpMetadataPreviewResponseDto> {
	return adminFetch<IdpMetadataPreviewResponseDto>(`${IDP_SETTINGS_API_PATH}/metadata-preview`);
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

export function changeAdminPassword(
	body: AdminChangePasswordRequestDto,
): Promise<AdminChangePasswordResponseDto> {
	return adminFetch<AdminChangePasswordResponseDto>('/api/admin/auth/change-password', {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function listAuditEvents(
	params: Record<string, string> = {},
): Promise<AuditEventListResponseDto> {
	const query = new URLSearchParams(params);
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<AuditEventListResponseDto>(`${AUDIT_EVENTS_API_PATH}${suffix}`);
}

export function auditExportUrl(params: Record<string, string>): string {
	const query = new URLSearchParams(params);
	return `${AUDIT_EVENTS_API_PATH}/export?${query.toString()}`;
}

export type { SpConnectionPublicDto };
