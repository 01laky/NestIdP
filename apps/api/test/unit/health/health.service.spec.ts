import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from '@api/health/services/health.service';
import { PrismaService } from '@api/prisma/services/prisma.service';

describe('HealthService', () => {
	let service: HealthService;
	let prisma: {
		pingDatabase: jest.Mock;
		appliedMigrationCount: jest.Mock;
		externalIdentityDatabase: { findUnique: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			pingDatabase: jest.fn(),
			appliedMigrationCount: jest.fn().mockResolvedValue(7),
			externalIdentityDatabase: { findUnique: jest.fn().mockResolvedValue(null) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [HealthService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(HealthService);
	});

	describe('getHealth', () => {
		it('returns ok without touching the database', async () => {
			expect(service.getHealth()).toEqual({ status: 'ok', service: 'nest-idp-api' });
			expect(prisma.pingDatabase).not.toHaveBeenCalled();
		});
	});

	describe('getReady', () => {
		it('returns 503 not_configured when DATABASE_URL is missing', async () => {
			const result = await service.getReady(undefined);
			expect(result.httpStatus).toBe(503);
			expect(result.body.database).toBe('not_configured');
			expect(prisma.pingDatabase).not.toHaveBeenCalled();
		});

		it('returns 503 not_configured when DATABASE_URL is blank', async () => {
			const result = await service.getReady('   ');
			expect(result.httpStatus).toBe(503);
			expect(result.body.database).toBe('not_configured');
		});

		it('returns 503 disconnected when ping fails', async () => {
			prisma.pingDatabase.mockResolvedValue(false);
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(503);
			expect(result.body.database).toBe('disconnected');
		});

		it('OPS-10: returns 200 connected with the applied migration count when ping succeeds', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
			expect(result.body.database).toBe('connected');
			expect(result.body.migrations).toBe(7);
		});

		it('OPS-10: omits the migration count and degrades to 503 when the DB is unreachable', async () => {
			prisma.pingDatabase.mockResolvedValue(false);
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(503);
			expect(result.body.migrations).toBeUndefined();
			expect(prisma.appliedMigrationCount).not.toHaveBeenCalled();
		});

		it('EXTDB-READY-01: includes external identity DB status when configured (mirror, reachable → 200)', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			prisma.externalIdentityDatabase.findUnique.mockResolvedValue({
				status: 'active',
				mode: 'mirror',
				reachable: true,
				outOfSync: false,
			});
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
			expect(result.body.externalIdentityDb).toEqual({
				status: 'active',
				mode: 'mirror',
				reachable: true,
				outOfSync: false,
			});
		});

		it('EXTDB-READY-02: degrades to 503 when an active relocate-mode external DB is unreachable', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			prisma.externalIdentityDatabase.findUnique.mockResolvedValue({
				status: 'active',
				mode: 'relocate',
				reachable: false,
				outOfSync: false,
			});
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(503);
			expect(result.body.status).toBe('unavailable');
			expect(result.body.externalIdentityDb?.reachable).toBe(false);
		});

		it('EXTDB-READY-03: an unreachable MIRROR external DB does not degrade readiness (local authoritative)', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			prisma.externalIdentityDatabase.findUnique.mockResolvedValue({
				status: 'active',
				mode: 'mirror',
				reachable: false,
				outOfSync: true,
			});
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
		});
	});
});
