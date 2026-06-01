import type {
	AdminDashboardResponseDto,
	AdminLoginRequestDto,
	AdminLoginResponseDto,
	AdminLogoutResponseDto,
	AdminMeResponseDto,
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	ApiConnectionTestResponseDto,
	ApiErrorResponseDto,
	CreateApiConnectionRequestDto,
	CreateSpConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	DeleteSpConnectionResponseDto,
	IdentityGroupListResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
	SpConnectionPublicDto,
	SpConnectionResponseDto,
	SpConnectionTestAcsResponseDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	TriggerSyncRequestDto,
	TriggerSyncResponseDto,
	UpdateApiConnectionRequestDto,
	UpdateSpConnectionRequestDto,
} from '@nestidp/shared';
import type { IdpMetadataUrlResponseDto, SpConnectionListResponseDto } from '@nestidp/shared';
import {
	ADMIN_CSRF_HEADER_NAME,
	API_CONNECTIONS_API_PATH,
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_USERS_API_PATH,
	IDP_METADATA_URL_API_PATH,
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

export function listIdentityUsers(
	params: { limit?: number; offset?: number; search?: string } = {},
): Promise<IdentityUserListResponseDto> {
	const query = new URLSearchParams();
	if (params.limit != null) {
		query.set('limit', String(params.limit));
	}
	if (params.offset != null) {
		query.set('offset', String(params.offset));
	}
	if (params.search) {
		query.set('search', params.search);
	}
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<IdentityUserListResponseDto>(`${IDENTITY_USERS_API_PATH}${suffix}`);
}

export function getIdentityUser(id: string): Promise<IdentityUserDetailResponseDto> {
	return adminFetch<IdentityUserDetailResponseDto>(`${IDENTITY_USERS_API_PATH}/${id}`);
}

export function listIdentityGroups(
	params: { limit?: number; offset?: number } = {},
): Promise<IdentityGroupListResponseDto> {
	const query = new URLSearchParams();
	if (params.limit != null) {
		query.set('limit', String(params.limit));
	}
	if (params.offset != null) {
		query.set('offset', String(params.offset));
	}
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<IdentityGroupListResponseDto>(`${IDENTITY_GROUPS_API_PATH}${suffix}`);
}

export function listIdentityRoles(
	params: { limit?: number; offset?: number } = {},
): Promise<IdentityRoleListResponseDto> {
	const query = new URLSearchParams();
	if (params.limit != null) {
		query.set('limit', String(params.limit));
	}
	if (params.offset != null) {
		query.set('offset', String(params.offset));
	}
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<IdentityRoleListResponseDto>(`${IDENTITY_ROLES_API_PATH}${suffix}`);
}

export type { SpConnectionPublicDto };
