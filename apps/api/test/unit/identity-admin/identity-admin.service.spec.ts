import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdentityOrigin } from '@prisma/client';
import { IdentityAdminAuditService } from '@api/identity-admin/services/identity-admin-audit.service';
import { IdentityAdminService } from '@api/identity-admin/services/identity-admin.service';
import { ActiveIdentityStore } from '@api/identity/store/active-identity-store';

function makeStoreMock() {
	return {
		listUsers: jest.fn(),
		getUserById: jest.fn(),
		getUserWithMemberships: jest.fn(),
		createManualUser: jest.fn(),
		updateManualUser: jest.fn(),
		deleteUser: jest.fn(),
		isUsernameTaken: jest.fn(),
		groupsExistAll: jest.fn(),
		rolesExistAll: jest.fn(),
		listGroups: jest.fn(),
		getGroupById: jest.fn(),
		getGroupMembers: jest.fn(),
		createManualGroup: jest.fn(),
		updateGroupName: jest.fn(),
		deleteGroup: jest.fn(),
		groupMemberCount: jest.fn(),
		isGroupNameTaken: jest.fn(),
		listRoles: jest.fn(),
		getRoleById: jest.fn(),
		getRoleMembers: jest.fn(),
		createManualRole: jest.fn(),
		updateRoleName: jest.fn(),
		deleteRole: jest.fn(),
		roleMemberCount: jest.fn(),
		isRoleNameTaken: jest.fn(),
	};
}

const baseUser = {
	id: 'u1',
	externalId: 'ext-1',
	apiConnectionId: 'conn-1',
	origin: IdentityOrigin.MANUAL,
	username: 'alice',
	email: null,
	displayName: null,
	passwordHash: 'hash',
	passwordHashAlgorithm: 'bcrypt',
	active: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};

describe('IdentityAdminService', () => {
	const prisma = {
		apiConnection: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
		auditEvent: { findMany: jest.fn() },
	};
	let store: ReturnType<typeof makeStoreMock>;
	const encryption = { encrypt: jest.fn() } as never;
	const audit = {
		logUserCreated: jest.fn(),
		logUserUpdated: jest.fn(),
		logUserDeleted: jest.fn(),
		logGroupCreated: jest.fn(),
		logGroupUpdated: jest.fn(),
		logGroupDeleted: jest.fn(),
		logRoleCreated: jest.fn(),
		logRoleUpdated: jest.fn(),
		logRoleDeleted: jest.fn(),
	} as unknown as IdentityAdminAuditService;
	const ssoSessions = { terminateAllForUser: jest.fn().mockResolvedValue(0) };
	let service: IdentityAdminService;

	beforeEach(() => {
		jest.clearAllMocks();
		store = makeStoreMock();
		service = new IdentityAdminService(
			prisma as never,
			store as unknown as ActiveIdentityStore,
			encryption,
			audit,
			ssoSessions as never,
		);
	});

	it('H4: deleteUser terminates the user’s SSO sessions before delete', async () => {
		store.getUserById.mockResolvedValue({ ...baseUser });
		store.deleteUser.mockResolvedValue(undefined);
		await service.deleteUser('u1');
		expect(ssoSessions.terminateAllForUser).toHaveBeenCalledWith('u1', 'user_deactivated');
		expect(store.deleteUser).toHaveBeenCalledWith('u1');
	});

	it('H4: updateUser deactivation (active true→false) terminates SSO sessions', async () => {
		store.getUserById.mockResolvedValue({ ...baseUser, active: true });
		store.updateManualUser.mockResolvedValue(undefined);
		const spy = jest.spyOn(service, 'getUserById').mockResolvedValue({} as never);
		await service.updateUser('u1', { active: false });
		expect(ssoSessions.terminateAllForUser).toHaveBeenCalledWith('u1', 'user_deactivated');
		spy.mockRestore();
	});

	it('H4: updateUser without deactivation does NOT terminate sessions', async () => {
		store.getUserById.mockResolvedValue({ ...baseUser, active: true });
		store.updateManualUser.mockResolvedValue(undefined);
		const spy = jest.spyOn(service, 'getUserById').mockResolvedValue({} as never);
		await service.updateUser('u1', { displayName: 'New Name' });
		expect(ssoSessions.terminateAllForUser).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('API-IDN-SVC-01: listUsers default limit 50 / offset 0', async () => {
		store.listUsers.mockResolvedValue({ items: [], total: 0 });
		await service.listUsers();
		expect(store.listUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
	});

	it('API-IDN-SVC-02: listUsers invalid limit → BadRequestException', async () => {
		await expect(service.listUsers(0)).rejects.toThrow(BadRequestException);
		await expect(service.listUsers(9999)).rejects.toThrow('limit must be between 1 and 200');
		await expect(service.listUsers(Number.NaN)).rejects.toThrow(BadRequestException);
	});

	it('API-IDN-SVC-03: listUsers negative offset → BadRequestException', async () => {
		await expect(service.listUsers(undefined, -1)).rejects.toThrow(
			'offset must be a non-negative number',
		);
	});

	it('API-IDN-SVC-04: passes the search term through to the store', async () => {
		store.listUsers.mockResolvedValue({ items: [], total: 0 });
		await service.listUsers(undefined, undefined, '  alice  ');
		expect(store.listUsers).toHaveBeenCalledWith(expect.objectContaining({ search: '  alice  ' }));
	});

	it('API-IDN-SVC-06: getUserById unknown → NotFoundException', async () => {
		store.getUserWithMemberships.mockResolvedValue(null);
		await expect(service.getUserById('c1234567890123456789012345')).rejects.toThrow(
			NotFoundException,
		);
	});

	it('API-IDN-SVC-07: getUserById sorts groups and roles by name and omits the password hash', async () => {
		store.getUserWithMemberships.mockResolvedValue({
			user: { ...baseUser, apiConnectionId: 'conn-1', origin: IdentityOrigin.SYNCED },
			groups: [
				{ id: 'g2', name: 'zeta', origin: IdentityOrigin.SYNCED },
				{ id: 'g1', name: 'alpha', origin: IdentityOrigin.SYNCED },
			],
			roles: [
				{ id: 'r2', name: 'viewer', origin: IdentityOrigin.SYNCED },
				{ id: 'r1', name: 'admin', origin: IdentityOrigin.SYNCED },
			],
		});
		prisma.apiConnection.findUnique.mockResolvedValue({
			id: 'conn-1',
			name: 'HR',
			isLocalDirectory: false,
		});

		const result = await service.getUserById('u1');

		expect(result.groups.map((g) => g.name)).toEqual(['alpha', 'zeta']);
		expect(result.roles.map((r) => r.name)).toEqual(['admin', 'viewer']);
		expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
	});

	it('API-IDN-SVC-08: listGroups returns total count', async () => {
		store.listGroups.mockResolvedValue({
			items: [
				{
					id: 'g1',
					name: 'a',
					externalId: 'e',
					apiConnectionId: 'c',
					origin: IdentityOrigin.SYNCED,
					createdAt: new Date(),
					updatedAt: new Date(),
					memberCount: 0,
				},
			],
			total: 1,
		});
		const result = await service.listGroups(10, 0);
		expect(result.total).toBe(1);
		expect(result.items).toHaveLength(1);
	});

	it('API-IDN-SVC-11: listUsers origin=manual passes the MANUAL origin to the store', async () => {
		store.listUsers.mockResolvedValue({ items: [], total: 0 });
		await service.listUsers(undefined, undefined, undefined, 'manual');
		expect(store.listUsers).toHaveBeenCalledWith(
			expect.objectContaining({ origin: IdentityOrigin.MANUAL }),
		);
	});

	it('API-IDN-SVC-12: parseAuditLimit rejects value above max', async () => {
		store.getUserWithMemberships.mockResolvedValue({
			user: { ...baseUser },
			groups: [],
			roles: [],
		});
		await expect(service.getUserById('u1', 25)).rejects.toThrow(BadRequestException);
	});
});
