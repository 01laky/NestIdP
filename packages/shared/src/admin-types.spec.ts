import { describe, expect, it } from 'vitest';
import type { AdminDashboardResponseDto, AdminStatsDto } from './admin-types.js';
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

describe('AdminDashboardResponseDto', () => {
	it('SH-ADM-03: includes dashboard routes and sync metadata fields', () => {
		const response: AdminDashboardResponseDto = {
			counts: {
				users: 0,
				groups: 0,
				roles: 0,
				apiConnections: 0,
				spConnections: 0,
			},
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: '/admin/sp-connections',
			identityUsersRoute: '/admin/identity/users',
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `https://idp.example.com${SAML_METADATA_PATH}`,
			entityId: 'https://idp.example.com',
			ssoUrl: 'https://idp.example.com/saml/sso',
			apiConnection: null,
			lastSyncStatus: null,
			lastSyncAt: null,
		};
		expect(response.entityId).toContain('idp.example.com');
		expect(response.lastSyncAt).toBeNull();
	});

	it('SH-ADM-04: apiConnectionsRoute points at identity source not SP', () => {
		const response: AdminDashboardResponseDto = {
			counts: {
				users: 0,
				groups: 0,
				roles: 0,
				apiConnections: 0,
				spConnections: 0,
			},
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: '/admin/sp-connections',
			identityUsersRoute: '/admin/identity/users',
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `https://idp.example.com${SAML_METADATA_PATH}`,
			entityId: 'https://idp.example.com',
			ssoUrl: 'https://idp.example.com/saml/sso',
			apiConnection: null,
			lastSyncStatus: 'NEVER',
			lastSyncAt: null,
		};
		expect(response.apiConnectionsRoute).toContain('api-connections');
		expect(response.apiConnectionsRoute).not.toContain('sp-connections');
	});
});
