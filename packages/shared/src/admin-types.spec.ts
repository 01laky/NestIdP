import { describe, expect, it } from 'vitest';
import type { AdminStatsDto, AdminStubResponseDto } from './admin-types.js';
import { API_CONNECTION_ROUTE_PREFIX, API_CONNECTIONS_API_PATH } from './connections.js';
import { SAML_METADATA_PATH, SP_CONNECTIONS_API_PATH } from './saml.js';
import { SYNC_API_PATH } from './sync.js';

describe('AdminStatsDto', () => {
	it('SH-ADM-01: requires all five count fields', () => {
		const stats: AdminStatsDto = {
			users: 1,
			groups: 2,
			roles: 3,
			apiConnections: 4,
			spConnections: 5,
		};
		expect(Object.keys(stats).sort()).toEqual([
			'apiConnections',
			'groups',
			'roles',
			'spConnections',
			'users',
		]);
	});

	it('SH-ADM-02: allows zero counts', () => {
		const stats: AdminStatsDto = {
			users: 0,
			groups: 0,
			roles: 0,
			apiConnections: 0,
			spConnections: 0,
		};
		expect(stats.users + stats.spConnections).toBe(0);
	});
});

describe('AdminStubResponseDto', () => {
	it('SH-ADM-03: status is literal stub and module is admin', () => {
		const response: AdminStubResponseDto = {
			status: 'stub',
			module: 'admin',
			note: 'pending',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `https://idp.example.com${SAML_METADATA_PATH}`,
			counts: {
				users: 0,
				groups: 0,
				roles: 0,
				apiConnections: 0,
				spConnections: 0,
			},
		};
		expect(response.status).toBe('stub');
		expect(response.module).toBe('admin');
	});

	it('SH-ADM-04: apiConnectionsRoute points at identity source not SP', () => {
		const response: AdminStubResponseDto = {
			status: 'stub',
			module: 'admin',
			note: '',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `https://idp.example.com${SAML_METADATA_PATH}`,
			counts: {
				users: 0,
				groups: 0,
				roles: 0,
				apiConnections: 0,
				spConnections: 0,
			},
		};
		expect(response.apiConnectionsRoute).toContain('api-connections');
		expect(response.apiConnectionsRoute).not.toContain('sp-connections');
	});
});
