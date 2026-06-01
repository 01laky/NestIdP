import { describe, expect, it } from 'vitest';
import {
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USERS_API_PATH,
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

	it('SH-IDN-03: user detail DTO shape', () => {
		const dto: IdentityUserDetailResponseDto = {
			user: {
				id: 'u1',
				username: 'alice',
				email: 'a@example.com',
				displayName: 'Alice',
				active: true,
				externalId: 'ext-1',
				apiConnectionId: 'c1',
			},
			groups: [{ id: 'g1', name: 'admins' }],
			roles: [{ id: 'r1', name: 'viewer' }],
		};
		expect(dto.groups[0]?.name).toBe('admins');
	});
});
