import { describe, expect, it } from 'vitest';
import type {
	ApiConnectionDto,
	ApiConnectionTestResponseDto,
	CreateApiConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	UpdateApiConnectionRequestDto,
} from '@shared/connections.js';
import { API_CONNECTION_ROUTE_PREFIX, API_CONNECTIONS_API_PATH } from '@shared/connections.js';

describe('connections shared types', () => {
	it('SH-CON-01: ApiConnectionDto shape smoke', () => {
		const dto: ApiConnectionDto = {
			id: 'c1',
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			authType: 'BEARER',
			hasBearerToken: true,
			apiContractConfig: null,
			oauthTokenUrl: null,
			oauthClientId: null,
			oauthScope: null,
			oauthAudience: null,
			oauthClientAuthMethod: null,
			oauthTokenRequestParams: null,
			hasOauthClientSecret: false,
			oauthLastTokenAt: null,
			proxyEnabled: false,
			proxyUrl: null,
			proxyUsername: null,
			hasProxyPassword: false,
			noProxyHosts: null,
			lastProxyCheckStatus: null,
			lastProxyCheckAt: null,
			lastSyncAt: null,
			lastSyncStatus: 'NEVER',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		expect(dto.hasBearerToken).toBe(true);
		expect(dto).not.toHaveProperty('bearerToken');
	});

	it('SH-CON-02: Create/Update request DTOs require expected fields', () => {
		const create: CreateApiConnectionRequestDto = {
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret',
		};
		const update: UpdateApiConnectionRequestDto = { name: 'Renamed' };
		expect(create.bearerToken).toBe('secret');
		expect(update.name).toBe('Renamed');
	});

	it('SH-CON-03: API_CONNECTIONS_API_PATH and API_CONNECTION_ROUTE_PREFIX differ', () => {
		expect(API_CONNECTIONS_API_PATH).toBe('/api/admin/api-connections');
		expect(API_CONNECTION_ROUTE_PREFIX).toBe('/admin/api-connections');
		expect(API_CONNECTIONS_API_PATH).not.toBe(API_CONNECTION_ROUTE_PREFIX);
	});

	it('SH-CON-04: DeleteApiConnectionResponseDto shape', () => {
		const dto: DeleteApiConnectionResponseDto = { ok: true, id: 'conn-1' };
		expect(dto.ok).toBe(true);
		expect(dto.id).toBe('conn-1');
	});

	it('SH-CON-05: ApiConnectionTestResponseDto shape', () => {
		const dto: ApiConnectionTestResponseDto = {
			ok: true,
			reachable: true,
			statusCode: 200,
			message: 'Identity API responded successfully',
		};
		expect(dto).not.toHaveProperty('bearerToken');
	});
});
