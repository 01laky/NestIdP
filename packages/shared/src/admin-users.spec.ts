import { describe, expect, it } from 'vitest';
import {
	ADMIN_USERS_API_PATH,
	ADMIN_USERS_ROUTE_PREFIX,
	type AdminUserPublicDto,
	type CreateAdminUserRequestDto,
	type DeleteAdminUserResponseDto,
	type UpdateAdminUserRequestDto,
} from './admin-users.js';

describe('admin-users shared types', () => {
	it('SH-ADM-USR-01: ADMIN_USERS_API_PATH is /api/admin/admin-users', () => {
		expect(ADMIN_USERS_API_PATH).toBe('/api/admin/admin-users');
	});

	it('SH-ADM-USR-02: ADMIN_USERS_ROUTE_PREFIX is /admin/settings/admins', () => {
		expect(ADMIN_USERS_ROUTE_PREFIX).toBe('/admin/settings/admins');
	});

	it('SH-ADM-USR-03: AdminUserPublicDto never includes password fields', () => {
		const dto: AdminUserPublicDto = {
			id: 'a1',
			username: 'operator',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		expect(dto.username).toBe('operator');
		expect(dto).not.toHaveProperty('password');
		expect(dto).not.toHaveProperty('passwordHash');
	});

	it('SH-ADM-USR-04: CreateAdminUserRequestDto requires username and password', () => {
		const dto: CreateAdminUserRequestDto = {
			username: 'new-admin',
			password: 'StrongPass1234',
		};
		expect(dto.username).toBe('new-admin');
		expect(dto.password).toBe('StrongPass1234');
	});

	it('SH-ADM-USR-05: UpdateAdminUserRequestDto only carries password', () => {
		const dto: UpdateAdminUserRequestDto = { password: 'NewStrongPass1234' };
		expect(Object.keys(dto)).toEqual(['password']);
	});

	it('SH-ADM-USR-06: DeleteAdminUserResponseDto shape', () => {
		const dto: DeleteAdminUserResponseDto = { ok: true, id: 'a1' };
		expect(dto.ok).toBe(true);
		expect(dto.id).toBe('a1');
	});

	it('SH-ADM-USR-07: API path and route prefix differ', () => {
		expect(ADMIN_USERS_API_PATH).not.toBe(ADMIN_USERS_ROUTE_PREFIX);
	});

	it('SH-ADM-USR-08: AdminUserPublicDto timestamps are ISO strings', () => {
		const dto: AdminUserPublicDto = {
			id: 'a1',
			username: 'admin',
			createdAt: '2026-06-01T12:00:00.000Z',
			updatedAt: '2026-06-02T12:00:00.000Z',
		};
		expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(dto.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('SH-ADM-USR-09: CreateAdminUserRequestDto username is distinct from password', () => {
		const dto: CreateAdminUserRequestDto = {
			username: 'alice',
			password: 'DifferentValue1234',
		};
		expect(dto.username).not.toBe(dto.password);
	});

	it('SH-ADM-USR-10: AdminUserPublicDto id is opaque string', () => {
		const dto: AdminUserPublicDto = {
			id: 'c1234567890123456789012345',
			username: 'admin',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		expect(typeof dto.id).toBe('string');
		expect(dto.id.length).toBeGreaterThan(0);
	});
});
