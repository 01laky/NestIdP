import { AuditRetentionCleanupService } from './audit-retention-cleanup.service';

describe('AuditRetentionCleanupService', () => {
	const prisma = {
		auditEvent: {
			deleteMany: jest.fn(),
		},
	};
	const configService = { get: jest.fn() };
	let service: AuditRetentionCleanupService;
	let logSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.clearAllMocks();
		configService.get.mockImplementation((key: string) => {
			if (key === 'AUDIT_RETENTION_DAYS') {
				return '90';
			}
			if (key === 'AUDIT_CLEANUP_INTERVAL_MS') {
				return '86400000';
			}
			return undefined;
		});
		service = new AuditRetentionCleanupService(prisma as never, configService as never);
		logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it('API-AUD-RET-01: purgeExpired deletes rows older than retention cutoff', async () => {
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 3 });

		const deleted = await service.purgeExpired();

		expect(deleted).toBe(3);
		const call = prisma.auditEvent.deleteMany.mock.calls[0][0];
		expect(call.where.createdAt.lt).toBeInstanceOf(Date);
	});

	it('API-AUD-RET-02: purgeExpired keeps recent rows (cutoff is now - retention days)', async () => {
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 0 });
		const before = Date.now();
		await service.purgeExpired();
		const cutoff: Date = prisma.auditEvent.deleteMany.mock.calls[0][0].where.createdAt.lt;
		const expectedMs = 90 * 24 * 60 * 60 * 1000;
		expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000);
		expect(before - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 1000);
	});

	it('API-AUD-RET-03: respects AUDIT_RETENTION_DAYS env override', async () => {
		configService.get.mockImplementation((key: string) => {
			if (key === 'AUDIT_RETENTION_DAYS') {
				return '7';
			}
			return '86400000';
		});
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 0 });
		const before = Date.now();
		await service.purgeExpired();
		const cutoff: Date = prisma.auditEvent.deleteMany.mock.calls[0][0].where.createdAt.lt;
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
		expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
	});

	it('API-AUD-RET-04: interval 0 runs purge once on module init without scheduling', () => {
		configService.get.mockImplementation((key: string) => {
			if (key === 'AUDIT_CLEANUP_INTERVAL_MS') {
				return '0';
			}
			if (key === 'AUDIT_RETENTION_DAYS') {
				return '90';
			}
			return undefined;
		});
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 0 });
		const setIntervalSpy = jest.spyOn(global, 'setInterval');

		service.onModuleInit();

		expect(setIntervalSpy).not.toHaveBeenCalled();
		expect(prisma.auditEvent.deleteMany).toHaveBeenCalled();
		setIntervalSpy.mockRestore();
	});

	it('API-AUD-RET-05: logs audit_retention_purged when rows deleted', async () => {
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 2 });
		await service.purgeExpired();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('"event":"audit_retention_purged"'),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"deletedCount":2'));
	});

	it('API-AUD-RET-06: purgeExpired does not throw when table empty', async () => {
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 0 });
		await expect(service.purgeExpired()).resolves.toBe(0);
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('API-AUD-RET-07: onModuleDestroy clears scheduled interval', () => {
		configService.get.mockImplementation((key: string) => {
			if (key === 'AUDIT_CLEANUP_INTERVAL_MS') {
				return '60000';
			}
			if (key === 'AUDIT_RETENTION_DAYS') {
				return '90';
			}
			return undefined;
		});
		prisma.auditEvent.deleteMany.mockResolvedValue({ count: 0 });
		const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
		service.onModuleInit();
		service.onModuleDestroy();
		expect(clearIntervalSpy).toHaveBeenCalled();
		clearIntervalSpy.mockRestore();
	});
});
