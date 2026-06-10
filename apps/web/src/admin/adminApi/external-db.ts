import type {
	ConnectExternalDbRequest,
	ConnectExternalDbResponseDto,
	DisconnectExternalDbRequest,
	ExternalDbConnectionInput,
	ExternalDbPreviewResponseDto,
	ExternalDbStatusResponseDto,
	TestExternalDbResponseDto,
} from '@nestidp/shared';
import { adminFetch } from './core';

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
