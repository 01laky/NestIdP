import type {
	AdminDashboardResponseDto,
	CreateSpConnectionRequestDto,
	DeleteSpConnectionResponseDto,
	IdpMetadataUrlResponseDto,
	ParseSloFromMetadataResponseDto,
	ProbeSpSigningRequestDto,
	ProbeSpSigningResponseDto,
	SpConnectionListResponseDto,
	SpConnectionResponseDto,
	SpConnectionTestAcsResponseDto,
	SpConnectionTestSsoUrlResponseDto,
	TestSpBackchannelSloResponseDto,
	UpdateSpConnectionRequestDto,
} from '@nestidp/shared';
import { IDP_METADATA_URL_API_PATH, SP_CONNECTIONS_API_PATH } from '@nestidp/shared';
import { adminFetch, toQuery } from './core';

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
	const suffix = toQuery({
		signed: options.signed,
		encrypted: options.encrypted,
		relayState: options.relayState,
	});
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

export type { SpConnectionPublicDto } from '@nestidp/shared';
