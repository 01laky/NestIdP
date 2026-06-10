import type {
	ProcessBackchannelResponseDto,
	ResendBackchannelLogoutResponseDto,
	SamlBackchannelQueueHealthDto,
	SamlSsoSessionListQueryDto,
	SamlSsoSessionListResponseDto,
	TerminateAllSamlSessionsResponseDto,
	TerminateSamlSessionResponseDto,
	TerminateSamlSessionsBulkResponseDto,
	TerminateSamlSessionsByUserResponseDto,
} from '@nestidp/shared';
import { SAML_SESSIONS_API_PATH } from '@nestidp/shared';
import { adminFetch, toQuery } from './core';

export function listSamlSessions(
	query: SamlSsoSessionListQueryDto = {},
): Promise<SamlSsoSessionListResponseDto> {
	const suffix = toQuery({
		status: query.status,
		spConnectionId: query.spConnectionId,
		apiConnectionId: query.apiConnectionId,
		q: query.q,
		page: query.page,
		pageSize: query.pageSize,
	});
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
