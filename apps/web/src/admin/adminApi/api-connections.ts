import type {
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	ApiConnectionTestResponseDto,
	ApiConnectionTestTokenResponseDto,
	CreateApiConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	ProxyCheckResultDto,
	UpdateApiConnectionRequestDto,
} from '@nestidp/shared';
import { API_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { adminFetch } from './core';

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
