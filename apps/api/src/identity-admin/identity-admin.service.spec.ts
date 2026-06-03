import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdentityOrigin } from '@prisma/client';
import { IdentityAdminAuditService } from './identity-admin-audit.service';
import { IdentityAdminService } from './identity-admin.service';
import { IdentityRepository } from '../identity/identity.repository';

describe('IdentityAdminService', () => {
	const prisma = {
		user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
		group: { findMany: jest.fn(), count: jest.fn() },
		role: { findMany: jest.fn(), count: jest.fn() },
		apiConnection: { findFirst: jest.fn() },
		auditEvent: { findMany: jest.fn() },
	};

	const identityRepository = {} as IdentityRepository;
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

	const service = new IdentityAdminService(prisma as never, identityRepository, encryption, audit);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-IDN-SVC-01: listUsers default limit 50', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers();

		expect(prisma.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 50, skip: 0 }),
		);
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

	it('API-IDN-SVC-04: search builds OR on username and email', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers(undefined, undefined, '  alice  ');

		expect(prisma.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					OR: [{ username: { contains: 'alice' } }, { email: { contains: 'alice' } }],
				},
			}),
		);
	});

	it('API-IDN-SVC-05: whitespace-only search uses empty where', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers(undefined, undefined, '   ');

		expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
	});

	it('API-IDN-SVC-06: getUserById unknown → NotFoundException', async () => {
		prisma.user.findUnique.mockResolvedValue(null);
		await expect(service.getUserById('c1234567890123456789012345')).rejects.toThrow(
			NotFoundException,
		);
	});

	it('API-IDN-SVC-07: getUserById sorts groups and roles by name', async () => {
		prisma.user.findUnique.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			email: null,
			displayName: null,
			active: true,
			externalId: 'ext-1',
			apiConnectionId: 'conn-1',
			origin: IdentityOrigin.SYNCED,
			groups: [
				{ group: { id: 'g2', name: 'zeta', origin: IdentityOrigin.SYNCED } },
				{ group: { id: 'g1', name: 'alpha', origin: IdentityOrigin.SYNCED } },
			],
			roles: [
				{ role: { id: 'r2', name: 'viewer', origin: IdentityOrigin.SYNCED } },
				{ role: { id: 'r1', name: 'admin', origin: IdentityOrigin.SYNCED } },
			],
			apiConnection: { id: 'conn-1', name: 'HR', isLocalDirectory: false },
		});

		const result = await service.getUserById('u1');

		expect(result.groups.map((g) => g.name)).toEqual(['alpha', 'zeta']);
		expect(result.roles.map((r) => r.name)).toEqual(['admin', 'viewer']);
	});

	it('API-IDN-SVC-08: listGroups returns total count', async () => {
		prisma.group.findMany.mockResolvedValue([
			{
				id: 'g1',
				name: 'a',
				externalId: 'e',
				apiConnectionId: 'c',
				origin: IdentityOrigin.SYNCED,
				_count: { users: 0 },
			},
		]);
		prisma.group.count.mockResolvedValue(1);

		const result = await service.listGroups(10, 0);
		expect(result.total).toBe(1);
		expect(result.items).toHaveLength(1);
	});

	it('API-IDN-SVC-09: listUsers select omits password fields', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers();

		const select = prisma.user.findMany.mock.calls[0][0].select as Record<string, boolean>;
		expect(select.passwordHash).toBeUndefined();
		expect(select.passwordHashAlgorithm).toBeUndefined();
	});

	it('API-IDN-SVC-11: listUsers origin=manual adds where clause', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);
		await service.listUsers(undefined, undefined, undefined, 'manual');
		expect(prisma.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ origin: IdentityOrigin.MANUAL }),
			}),
		);
	});

	it('API-IDN-SVC-12: parseAuditLimit rejects value above max', async () => {
		prisma.user.findUnique.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			email: null,
			displayName: null,
			active: true,
			externalId: 'ext-1',
			apiConnectionId: 'conn-1',
			origin: IdentityOrigin.MANUAL,
			groups: [],
			roles: [],
			apiConnection: { id: 'conn-1', name: 'Local directory', isLocalDirectory: true },
		});
		await expect(service.getUserById('u1', 25)).rejects.toThrow(BadRequestException);
	});

	it('API-IDN-SVC-10: getUserById select omits password fields', async () => {
		prisma.user.findUnique.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			email: null,
			displayName: null,
			active: true,
			externalId: 'ext-1',
			apiConnectionId: 'conn-1',
			origin: IdentityOrigin.SYNCED,
			groups: [],
			roles: [],
			apiConnection: { id: 'conn-1', name: 'HR', isLocalDirectory: false },
		});

		await service.getUserById('u1');

		const select = prisma.user.findUnique.mock.calls[0][0].select as Record<string, boolean>;
		expect(select.passwordHash).toBeUndefined();
	});
});
