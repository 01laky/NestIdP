import type {
	ConnectExternalDbRequest,
	ConnectExternalDbResponseDto,
	DisconnectExternalDbRequest,
	ExternalDbConnectionInput,
	ExternalDbPreviewResponseDto,
	ExternalDbStatusResponseDto,
	TestExternalDbResponseDto,
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
	UnlockAccountResponseDto,
	UpdateAdminUserRequestDto,
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	ApiConnectionTestResponseDto,
	ApiConnectionTestTokenResponseDto,
	ApiErrorResponseDto,
	ProxyCheckResultDto,
	CreateApiConnectionRequestDto,
	CreateSpConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	DeleteSpConnectionResponseDto,
	IdpMetadataPreviewResponseDto,
	GenerateIdpEncryptionCertRequestDto,
	GenerateIdpSigningCertRequestDto,
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
	ProbeSpSigningRequestDto,
	ProbeSpSigningResponseDto,
	SpConnectionTestSsoUrlResponseDto,
	UpdateManualIdentityGroupDto,
	UpdateManualIdentityRoleDto,
	UpdateManualIdentityUserDto,
	SpConnectionPublicDto,
	SpConnectionResponseDto,
	SpConnectionTestAcsResponseDto,
	StartIdpCertRotationRequestDto,
	StartIdpEncryptionCertRotationRequestDto,
	RemoveSourceIdentitiesMode,
	RemoveSourceIdentitiesResponseDto,
	SyncAllResponseDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	TriggerSyncRequestDto,
	TriggerSyncResponseDto,
	UpdateApiConnectionRequestDto,
	UpdateIdpSettingsRequestDto,
	UpdateSpConnectionRequestDto,
	UploadIdpEncryptionCertRequestDto,
	UploadIdpSigningCertRequestDto,
} from '@nestidp/shared';
import type {
	IdentitySourcesResponseDto,
	IdpMetadataUrlResponseDto,
	ParseSloFromMetadataResponseDto,
	ProcessBackchannelResponseDto,
	ResendBackchannelLogoutResponseDto,
	SamlBackchannelQueueHealthDto,
	SamlSsoSessionListQueryDto,
	SamlSsoSessionListResponseDto,
	SpConnectionListResponseDto,
	TerminateAllSamlSessionsResponseDto,
	TerminateSamlSessionResponseDto,
	TerminateSamlSessionsBulkResponseDto,
	TerminateSamlSessionsByUserResponseDto,
	TestSpBackchannelSloResponseDto,
} from '@nestidp/shared';
import type {
	ScheduleResponseDto,
	SchedulesOverviewResponseDto,
	SyncTriggerSource,
	UpdateScheduleRequestDto,
} from '@nestidp/shared';
import {
	ADMIN_CSRF_HEADER_NAME,
	API_CONNECTIONS_API_PATH,
	IDENTITY_LIST_PAGE_SIZE,
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_SOURCES_API_PATH,
	IDENTITY_USERS_API_PATH,
	IDP_METADATA_URL_API_PATH,
	IDP_SETTINGS_API_PATH,
	ADMIN_USERS_API_PATH,
	AUDIT_EVENTS_API_PATH,
	SAML_SESSIONS_API_PATH,
	SP_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
	syncSchedulePath,
	syncSchedulesOverviewPath,
} from '@nestidp/shared';

export class AdminApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		/** Seconds from the `Retry-After` header on a 429 throttle/lockout response (Prompt 35). */
		public readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = 'AdminApiError';
	}
}

function parseRetryAfterSeconds(response: Response): number | undefined {
	const raw = response.headers?.get?.('Retry-After');
	if (!raw) {
		return undefined;
	}
	const seconds = Number.parseInt(raw, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
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
		throw new AdminApiError(error.statusCode, error.message, parseRetryAfterSeconds(response));
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

export function testApiConnectionToken(id: string): Promise<ApiConnectionTestTokenResponseDto> {
	return adminFetch<ApiConnectionTestTokenResponseDto>(
		`${API_CONNECTIONS_API_PATH}/${id}/test-token`,
		{
			method: 'POST',
		},
	);
}

export function testApiConnectionProxy(id: string): Promise<ProxyCheckResultDto> {
	return adminFetch<ProxyCheckResultDto>(`${API_CONNECTIONS_API_PATH}/${id}/test-proxy`, {
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

/** "Sync all sources" bulk trigger (Prompt 37). */
export function syncAllSources(options: { dryRun?: boolean } = {}): Promise<SyncAllResponseDto> {
	return adminFetch<SyncAllResponseDto>(`${SYNC_API_PATH}/all`, {
		method: 'POST',
		body: JSON.stringify({ dryRun: options.dryRun === true }),
	});
}

/** Remove a sync source's identities (Prompt 37). */
export function removeSourceIdentities(
	connectionId: string,
	mode: RemoveSourceIdentitiesMode,
): Promise<RemoveSourceIdentitiesResponseDto> {
	return adminFetch<RemoveSourceIdentitiesResponseDto>(
		`${API_CONNECTIONS_API_PATH}/${connectionId}/remove-identities`,
		{ method: 'POST', body: JSON.stringify({ mode }) },
	);
}

/** Identity source options for the Source filter (Prompt 37). */
export function listIdentitySources(): Promise<IdentitySourcesResponseDto> {
	return adminFetch<IdentitySourcesResponseDto>(IDENTITY_SOURCES_API_PATH);
}

export function getSyncStatus(connectionId: string): Promise<SyncStatusResponseDto> {
	return adminFetch<SyncStatusResponseDto>(`${SYNC_API_PATH}/${connectionId}/status`);
}

export function listSyncLogs(
	connectionId: string,
	limit?: number,
	source?: SyncTriggerSource,
): Promise<SyncLogListResponseDto> {
	const params = new URLSearchParams();
	if (limit != null) {
		params.set('limit', String(limit));
	}
	if (source) {
		params.set('source', source);
	}
	const query = params.toString() ? `?${params.toString()}` : '';
	return adminFetch<SyncLogListResponseDto>(`${SYNC_API_PATH}/${connectionId}/logs${query}`);
}

export function getSyncLog(syncLogId: string): Promise<SyncLogResponseDto> {
	return adminFetch<SyncLogResponseDto>(`${SYNC_API_PATH}/logs/${syncLogId}`);
}

export function getSyncSchedule(connectionId: string): Promise<ScheduleResponseDto> {
	return adminFetch<ScheduleResponseDto>(syncSchedulePath(connectionId));
}

export function updateSyncSchedule(
	connectionId: string,
	body: UpdateScheduleRequestDto,
): Promise<ScheduleResponseDto> {
	return adminFetch<ScheduleResponseDto>(syncSchedulePath(connectionId), {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function getSchedulesOverview(): Promise<SchedulesOverviewResponseDto> {
	return adminFetch<SchedulesOverviewResponseDto>(syncSchedulesOverviewPath());
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

export function testSpConnectionBackchannel(id: string): Promise<TestSpBackchannelSloResponseDto> {
	return adminFetch<TestSpBackchannelSloResponseDto>(
		`${SP_CONNECTIONS_API_PATH}/${id}/test-backchannel`,
		{ method: 'POST' },
	);
}

export function getSpConnectionTestSsoUrl(
	id: string,
	options: { signed?: boolean; encrypted?: boolean; relayState?: string } = {},
): Promise<SpConnectionTestSsoUrlResponseDto> {
	const query = new URLSearchParams();
	if (options.signed !== undefined) {
		query.set('signed', String(options.signed));
	}
	if (options.encrypted !== undefined) {
		query.set('encrypted', String(options.encrypted));
	}
	if (options.relayState) {
		query.set('relayState', options.relayState);
	}
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<SpConnectionTestSsoUrlResponseDto>(
		`${SP_CONNECTIONS_API_PATH}/${id}/test-sso-url${suffix}`,
	);
}

export function probeSpConnectionSigning(
	id: string,
	body: ProbeSpSigningRequestDto,
): Promise<ProbeSpSigningResponseDto> {
	return adminFetch<ProbeSpSigningResponseDto>(
		`${SP_CONNECTIONS_API_PATH}/${id}/probe-sp-signing`,
		{
			method: 'POST',
			body: JSON.stringify(body),
		},
	);
}

export function parseSpSloFromMetadata(
	metadataXml: string,
): Promise<ParseSloFromMetadataResponseDto> {
	return adminFetch<ParseSloFromMetadataResponseDto>(
		`${SP_CONNECTIONS_API_PATH}/parse-slo-from-metadata`,
		{ method: 'POST', body: JSON.stringify({ metadataXml }) },
	);
}

export function listSamlSessions(
	query: SamlSsoSessionListQueryDto = {},
): Promise<SamlSsoSessionListResponseDto> {
	const params = new URLSearchParams();
	if (query.status) params.set('status', query.status);
	if (query.spConnectionId) params.set('spConnectionId', query.spConnectionId);
	if (query.q) params.set('q', query.q);
	if (query.page) params.set('page', String(query.page));
	if (query.pageSize) params.set('pageSize', String(query.pageSize));
	const suffix = params.size > 0 ? `?${params.toString()}` : '';
	return adminFetch<SamlSsoSessionListResponseDto>(`${SAML_SESSIONS_API_PATH}${suffix}`);
}

export function terminateSamlSession(id: string): Promise<TerminateSamlSessionResponseDto> {
	return adminFetch<TerminateSamlSessionResponseDto>(`${SAML_SESSIONS_API_PATH}/${id}/terminate`, {
		method: 'POST',
	});
}

export function terminateSamlSessionsByUser(
	userId: string,
): Promise<TerminateSamlSessionsByUserResponseDto> {
	return adminFetch<TerminateSamlSessionsByUserResponseDto>(
		`${SAML_SESSIONS_API_PATH}/terminate-by-user`,
		{ method: 'POST', body: JSON.stringify({ userId }) },
	);
}

export function terminateSamlSessionsBulk(
	ids: string[],
): Promise<TerminateSamlSessionsBulkResponseDto> {
	return adminFetch<TerminateSamlSessionsBulkResponseDto>(`${SAML_SESSIONS_API_PATH}/terminate`, {
		method: 'POST',
		body: JSON.stringify({ ids }),
	});
}

export function terminateAllSamlSessions(): Promise<TerminateAllSamlSessionsResponseDto> {
	return adminFetch<TerminateAllSamlSessionsResponseDto>(
		`${SAML_SESSIONS_API_PATH}/terminate-all`,
		{ method: 'POST' },
	);
}

export function resendBackchannelLogout(
	id: string,
	spConnectionId: string,
): Promise<ResendBackchannelLogoutResponseDto> {
	return adminFetch<ResendBackchannelLogoutResponseDto>(
		`${SAML_SESSIONS_API_PATH}/${id}/resend-backchannel/${spConnectionId}`,
		{ method: 'POST' },
	);
}

export function processBackchannelQueue(): Promise<ProcessBackchannelResponseDto> {
	return adminFetch<ProcessBackchannelResponseDto>(
		`${SAML_SESSIONS_API_PATH}/process-backchannel`,
		{ method: 'POST' },
	);
}

export function getBackchannelQueueHealth(): Promise<SamlBackchannelQueueHealthDto> {
	return adminFetch<SamlBackchannelQueueHealthDto>(`${SAML_SESSIONS_API_PATH}/backchannel-health`);
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
	params: {
		limit?: number;
		offset?: number;
		search?: string;
		origin?: string;
		apiConnectionId?: string;
	} = {},
): Promise<IdentityUserListResponseDto> {
	return adminFetch<IdentityUserListResponseDto>(
		`${IDENTITY_USERS_API_PATH}${identityQuery({
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
	params: { limit?: number; offset?: number; origin?: string; apiConnectionId?: string } = {},
): Promise<IdentityGroupListResponseDto> {
	return adminFetch<IdentityGroupListResponseDto>(
		`${IDENTITY_GROUPS_API_PATH}${identityQuery({
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
		`${IDENTITY_ROLES_API_PATH}${identityQuery({
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

export function runCertRotationCheck(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/cert-rotation/run-check`, {
		method: 'POST',
	});
}

export function generateIdpSigningCert(
	body: GenerateIdpSigningCertRequestDto = {},
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`, {
		method: 'POST',
		body: JSON.stringify(body),
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

export function generateIdpEncryptionCert(
	body: GenerateIdpEncryptionCertRequestDto = {},
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function uploadIdpEncryptionCert(
	body: UploadIdpEncryptionCertRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function startIdpEncryptionCertRotation(
	body: StartIdpEncryptionCertRotationRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`,
		{
			method: 'POST',
			body: JSON.stringify(body),
		},
	);
}

export function completeIdpEncryptionCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/complete`,
		{
			method: 'POST',
		},
	);
}

export function cancelIdpEncryptionCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`,
		{
			method: 'POST',
		},
	);
}

export function getIdpEncryptionCertPublicPem(): Promise<{ certPem: string }> {
	return adminFetch<{ certPem: string }>(`${IDP_SETTINGS_API_PATH}/encryption-cert/public-pem`);
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

export function unlockAdminUser(id: string): Promise<UnlockAccountResponseDto> {
	return adminFetch<UnlockAccountResponseDto>(`${ADMIN_USERS_API_PATH}/${id}/unlock`, {
		method: 'POST',
	});
}

export function unlockIdentityUser(id: string): Promise<UnlockAccountResponseDto> {
	return adminFetch<UnlockAccountResponseDto>(`${IDENTITY_USERS_API_PATH}/${id}/unlock`, {
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

// --- External identity database (Prompt 31) ---

const IDENTITY_DB_API_PATH = '/api/admin/identity-database';

export function getExternalIdentityDbStatus(): Promise<ExternalDbStatusResponseDto> {
	return adminFetch<ExternalDbStatusResponseDto>(IDENTITY_DB_API_PATH);
}

export function testExternalIdentityDb(
	body: ExternalDbConnectionInput,
): Promise<TestExternalDbResponseDto> {
	return adminFetch<TestExternalDbResponseDto>(`${IDENTITY_DB_API_PATH}/test`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function previewExternalIdentityDb(
	body: ConnectExternalDbRequest,
): Promise<ExternalDbPreviewResponseDto> {
	return adminFetch<ExternalDbPreviewResponseDto>(`${IDENTITY_DB_API_PATH}/preview`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function connectExternalIdentityDb(
	body: ConnectExternalDbRequest,
): Promise<ConnectExternalDbResponseDto> {
	return adminFetch<ConnectExternalDbResponseDto>(IDENTITY_DB_API_PATH, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function resyncExternalIdentityDb(): Promise<ExternalDbStatusResponseDto> {
	return adminFetch<ExternalDbStatusResponseDto>(`${IDENTITY_DB_API_PATH}/resync`, {
		method: 'POST',
	});
}

export function disconnectExternalIdentityDb(
	body: DisconnectExternalDbRequest,
): Promise<ExternalDbStatusResponseDto> {
	return adminFetch<ExternalDbStatusResponseDto>(IDENTITY_DB_API_PATH, {
		method: 'DELETE',
		body: JSON.stringify(body),
	});
}
