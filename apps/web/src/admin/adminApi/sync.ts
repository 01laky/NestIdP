import type {
	IdentitySourcesResponseDto,
	RemoveSourceIdentitiesMode,
	RemoveSourceIdentitiesResponseDto,
	ScheduleResponseDto,
	SchedulesOverviewResponseDto,
	SyncAllResponseDto,
	SyncLogListResponseDto,
	SyncLogResponseDto,
	SyncStatusResponseDto,
	SyncTriggerSource,
	TriggerSyncRequestDto,
	TriggerSyncResponseDto,
	UpdateScheduleRequestDto,
} from '@nestidp/shared';
import {
	API_CONNECTIONS_API_PATH,
	IDENTITY_SOURCES_API_PATH,
	SYNC_API_PATH,
	syncSchedulePath,
	syncSchedulesOverviewPath,
} from '@nestidp/shared';
import { adminFetch, toQuery } from './core';

export function triggerIdentitySync(
	connectionId: string,
	options: TriggerSyncRequestDto = {},
): Promise<TriggerSyncResponseDto> {
	return adminFetch<TriggerSyncResponseDto>(`${SYNC_API_PATH}/${connectionId}`, {
		method: 'POST',
		body: JSON.stringify(options),
	});
}

export function syncAllSources(options: { dryRun?: boolean } = {}): Promise<SyncAllResponseDto> {
	return adminFetch<SyncAllResponseDto>(`${SYNC_API_PATH}/all`, {
		method: 'POST',
		body: JSON.stringify({ dryRun: options.dryRun === true }),
	});
}

export function removeSourceIdentities(
	connectionId: string,
	mode: RemoveSourceIdentitiesMode,
): Promise<RemoveSourceIdentitiesResponseDto> {
	return adminFetch<RemoveSourceIdentitiesResponseDto>(
		`${API_CONNECTIONS_API_PATH}/${connectionId}/remove-identities`,
		{ method: 'POST', body: JSON.stringify({ mode }) },
	);
}

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
	const query = toQuery({ limit, source });
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
