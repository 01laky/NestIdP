import { describe, expect, it } from 'vitest';
import {
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_GROUP_NEW_ROUTE,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	IDENTITY_USERS_API_PATH,
	LOCAL_DIRECTORY_CONNECTION_NAME,
	identityGroupDetailRoute,
	identityUserEditRoute,
	type IdentityUserDetailResponseDto,
} from './identity-admin.js';

describe('identity-admin shared', () => {
	it('SH-IDN-01: API paths under /api/admin/identity', () => {
		expect(IDENTITY_USERS_API_PATH).toBe('/api/admin/identity/users');
		expect(IDENTITY_GROUPS_API_PATH).toBe('/api/admin/identity/groups');
		expect(IDENTITY_ROLES_API_PATH).toBe('/api/admin/identity/roles');
	});

	it('SH-IDN-02: UI route prefix separate from API paths', () => {
		expect(IDENTITY_ROUTE_PREFIX).toBe('/admin/identity');
		expect(IDENTITY_USERS_API_PATH).not.toBe(`${IDENTITY_ROUTE_PREFIX}/users`);
	});

	it('SH-IDN-03: user detail DTO shape includes origin and source', () => {
		const dto: IdentityUserDetailResponseDto = {
			user: {
				id: 'u1',
				username: 'alice',
				email: 'a@example.com',
				displayName: 'Alice',
				active: true,
				externalId: 'manual:user:u1',
				apiConnectionId: 'c1',
				origin: 'manual',
			},
			groups: [{ id: 'g1', name: 'admins' }],
			roles: [{ id: 'r1', name: 'viewer' }],
			source: {
				kind: 'local_directory',
				label: LOCAL_DIRECTORY_CONNECTION_NAME,
				apiConnectionId: 'c1',
				apiConnectionRoute: null,
			},
		};
		expect(dto.groups[0]?.name).toBe('admins');
	});

	it('SH-IDN-MAN-01: route helpers for manual CRUD pages', () => {
		expect(IDENTITY_USER_NEW_ROUTE).toBe('/admin/identity/users/new');
		expect(IDENTITY_GROUP_NEW_ROUTE).toBe('/admin/identity/groups/new');
		expect(identityUserEditRoute('u1')).toBe('/admin/identity/users/u1/edit');
		expect(identityGroupDetailRoute('g1')).toBe('/admin/identity/groups/g1');
	});
});
