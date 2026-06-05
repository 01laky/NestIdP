import type { SyncLogErrorEntryDto } from '@nestidp/shared';
import { appendSyncError, capSyncErrors, SyncLogService } from '@api/sync/services/sync-log.service';

function makeError(index: number): SyncLogErrorEntryDto {
	return {
		phase: 'parse_users',
		message: `Error ${index}`,
	};
}

describe('capSyncErrors', () => {
	it('returns null for null input', () => {
		expect(capSyncErrors(null)).toBeNull();
	});

	it('returns null for empty array', () => {
		expect(capSyncErrors([])).toBeNull();
	});

	it('returns array unchanged when length <= 100', () => {
		const errors = [makeError(1), makeError(2)];
		expect(capSyncErrors(errors)).toBe(errors);
		expect(capSyncErrors(errors)).toHaveLength(2);
	});

	it('caps at 100 entries with truncation message when over limit', () => {
		const errors = Array.from({ length: 150 }, (_, i) => makeError(i));
		const capped = capSyncErrors(errors);
		expect(capped).toHaveLength(100);
		expect(capped![99]).toEqual({
			phase: 'parse_users',
			message: 'Additional errors truncated',
		});
		expect(capped![0]).toEqual(makeError(0));
		expect(capped![98]).toEqual(makeError(98));
	});

	it('appendSyncError appends then caps', () => {
		const initial = [makeError(1)];
		const next = appendSyncError(initial, makeError(2));
		expect(next).toHaveLength(2);
		expect(next[1]).toEqual(makeError(2));
	});

	it('appendSyncError returns capped array when append exceeds limit', () => {
		const initial = Array.from({ length: 100 }, (_, i) => makeError(i));
		const next = appendSyncError(initial, makeError(999));
		expect(next).toHaveLength(100);
		expect(next[99]).toEqual({
			phase: 'parse_users',
			message: 'Additional errors truncated',
		});
	});
});

describe('SyncLogService', () => {
	const prisma = {
		syncLog: {
			create: jest.fn(),
			update: jest.fn(),
			findMany: jest.fn(),
			findUnique: jest.fn(),
			findFirst: jest.fn(),
		},
	};

	const service = new SyncLogService(prisma as never);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('createRunningLog creates RUNNING row', async () => {
		const row = { id: 'log-1', status: 'RUNNING' };
		prisma.syncLog.create.mockResolvedValue(row);

		await expect(service.createRunningLog('conn-1')).resolves.toBe(row);
		expect(prisma.syncLog.create).toHaveBeenCalledWith({
			data: { apiConnectionId: 'conn-1', status: 'RUNNING' },
		});
	});

	it('finishLog caps errors before persisting', async () => {
		const errors = Array.from({ length: 150 }, (_, i) => makeError(i));
		const finished = { id: 'log-1', status: 'SUCCESS' };
		prisma.syncLog.update.mockResolvedValue(finished);

		await service.finishLog(
			'log-1',
			'SUCCESS',
			{ usersSynced: 0, groupsSynced: 0, rolesSynced: 0 },
			errors,
		);

		const updateData = prisma.syncLog.update.mock.calls[0][0].data;
		expect(updateData.errors).toHaveLength(100);
		expect(updateData.errors[99]).toEqual({
			phase: 'parse_users',
			message: 'Additional errors truncated',
		});
	});

	it('finishLog stores Prisma.JsonNull when errors null', async () => {
		const { Prisma } = await import('@prisma/client');
		prisma.syncLog.update.mockResolvedValue({ id: 'log-1' });

		await service.finishLog(
			'log-1',
			'FAILED',
			{ usersSynced: 0, groupsSynced: 0, rolesSynced: 0 },
			null,
		);

		expect(prisma.syncLog.update.mock.calls[0][0].data.errors).toBe(Prisma.JsonNull);
	});
});
