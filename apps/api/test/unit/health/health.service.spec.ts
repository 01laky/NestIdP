import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from '@api/health/services/health.service';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { countMigrationDirs } from '@api/prisma/db-migrator';
import { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';
import { SyncSchedulerService } from '@api/sync/services/sync-scheduler.service';
import { CertRotationSchedulerService } from '@api/idp-settings/services/cert-rotation-scheduler.service';
import { BackchannelLogoutSchedulerService } from '@api/saml/services/backchannel-logout-scheduler.service';

jest.mock('@api/prisma/db-migrator', () => ({
	...jest.requireActual('@api/prisma/db-migrator'),
	countMigrationDirs: jest.fn(() => 7),
}));

const countMigrationDirsMock = countMigrationDirs as jest.Mock;

describe('HealthService', () => {
	let service: HealthService;
	let prisma: {
		pingDatabase: jest.Mock;
		appliedMigrationCount: jest.Mock;
		externalIdentityDatabase: { findUnique: jest.Mock };
		apiConnection: { count: jest.Mock };
	};
	let configValues: Record<string, string | undefined>;
	let auditPersistence: { persistFailureStats: jest.Mock };
	let syncScheduler: { tickStats: jest.Mock };
	let certRotationScheduler: { tickStats: jest.Mock };
	let backchannelScheduler: { tickStats: jest.Mock };

	const nullTick = { lastTickAt: null, lastProcessed: null };

	beforeEach(async () => {
		configValues = {};
		countMigrationDirsMock.mockReturnValue(7);
		prisma = {
			pingDatabase: jest.fn(),
			appliedMigrationCount: jest.fn().mockResolvedValue(7),
			externalIdentityDatabase: { findUnique: jest.fn().mockResolvedValue(null) },
			apiConnection: { count: jest.fn().mockResolvedValue(0) },
		};
		auditPersistence = {
			persistFailureStats: jest.fn().mockReturnValue({ count: 0, lastAt: null }),
		};
		syncScheduler = { tickStats: jest.fn().mockReturnValue({ ...nullTick }) };
		certRotationScheduler = { tickStats: jest.fn().mockReturnValue({ ...nullTick }) };
		backchannelScheduler = { tickStats: jest.fn().mockReturnValue({ ...nullTick }) };
		const configService = { get: jest.fn((key: string) => configValues[key]) };
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				HealthService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configService },
				{ provide: AuditPersistenceService, useValue: auditPersistence },
				{ provide: SyncSchedulerService, useValue: syncScheduler },
				{ provide: CertRotationSchedulerService, useValue: certRotationScheduler },
				{ provide: BackchannelLogoutSchedulerService, useValue: backchannelScheduler },
			],
		}).compile();
		service = module.get(HealthService);
	});

	describe('getHealth', () => {
		it('returns ok without touching the database', async () => {
			expect(service.getHealth()).toMatchObject({ status: 'ok', service: 'nest-idp-api' });
			expect(prisma.pingDatabase).not.toHaveBeenCalled();
		});

		it('OPS-12: includes version, null gitSha when unset, uptime > 0, and null-before-tick gauges', () => {
			const body = service.getHealth();
			// npm_package_version is unset in the config mock → fallback to the api package.json
			expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
			expect(body.gitSha).toBeNull();
			expect(body.uptimeSeconds).toBeGreaterThan(0);
			expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
			expect(body.audit).toEqual({ persistFailures: 0, lastPersistFailureAt: null });
			expect(body.schedulers).toEqual({
				backchannel: nullTick,
				sync: nullTick,
				certRotation: nullTick,
			});
		});

		it('OPS-13: surfaces BUILD_GIT_SHA and prefers npm_package_version when present', () => {
			configValues.BUILD_GIT_SHA = 'abc1234def';
			configValues.npm_package_version = '9.9.9-test';
			const body = service.getHealth();
			expect(body.gitSha).toBe('abc1234def');
			expect(body.version).toBe('9.9.9-test');
		});

		it('OPS-14: reflects audit persist failure stats', () => {
			auditPersistence.persistFailureStats.mockReturnValue({
				count: 3,
				lastAt: '2026-06-10T10:00:00.000Z',
			});
			expect(service.getHealth().audit).toEqual({
				persistFailures: 3,
				lastPersistFailureAt: '2026-06-10T10:00:00.000Z',
			});
		});

		it('OPS-15: reflects per-scheduler tick gauges after ticks', () => {
			backchannelScheduler.tickStats.mockReturnValue({
				lastTickAt: '2026-06-10T10:00:01.000Z',
				lastProcessed: 4,
			});
			syncScheduler.tickStats.mockReturnValue({
				lastTickAt: '2026-06-10T10:00:02.000Z',
				lastProcessed: 1,
			});
			certRotationScheduler.tickStats.mockReturnValue({
				lastTickAt: '2026-06-10T10:00:03.000Z',
				lastProcessed: 2,
			});
			expect(service.getHealth().schedulers).toEqual({
				backchannel: { lastTickAt: '2026-06-10T10:00:01.000Z', lastProcessed: 4 },
				sync: { lastTickAt: '2026-06-10T10:00:02.000Z', lastProcessed: 1 },
				certRotation: { lastTickAt: '2026-06-10T10:00:03.000Z', lastProcessed: 2 },
			});
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

		it('OPS-10: returns 200 connected with applied/available/upToDate migrations when ping succeeds', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
			expect(result.body.database).toBe('connected');
			expect(result.body.migrations).toEqual({ applied: 7, available: 7, upToDate: true });
		});

		it('OPS-16: migrations upToDate=false when fewer applied than available on disk', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			prisma.appliedMigrationCount.mockResolvedValue(5);
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.body.migrations).toEqual({ applied: 5, available: 7, upToDate: false });
		});

		it('OPS-17: an unreadable migrations dir reports available=0 instead of breaking readiness', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			countMigrationDirsMock.mockImplementation(() => {
				throw new Error('EACCES');
			});
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
			expect(result.body.migrations).toEqual({ applied: 7, available: 0, upToDate: true });
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

		it('HARD-OVERVIEW-01: /ready reflects scheduler enabled + scheduled/due counts', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			prisma.apiConnection.count
				.mockResolvedValueOnce(3) // scheduledConnections
				.mockResolvedValueOnce(1); // due
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.httpStatus).toBe(200);
			expect(result.body.scheduler).toEqual({
				enabled: true,
				scheduledConnections: 3,
				due: 1,
			});
		});

		it('HARD-OVERVIEW-02: /ready reports scheduler disabled when SYNC_SCHEDULER_TICK_MS=0', async () => {
			prisma.pingDatabase.mockResolvedValue(true);
			configValues.SYNC_SCHEDULER_TICK_MS = '0';
			const result = await service.getReady('file:../data/nestidp.db');
			expect(result.body.scheduler?.enabled).toBe(false);
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
