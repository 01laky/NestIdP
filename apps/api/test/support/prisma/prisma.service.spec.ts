import { PrismaService } from '@api/prisma/services/prisma.service';

describe('PrismaService', () => {
	let service: PrismaService;

	beforeEach(() => {
		// Construct the adapter against a (never-touched) temp file; all queries are mocked below.
		service = new PrismaService({ url: 'file:/tmp/nestidp-prisma-service-spec.db' });
	});

	afterEach(async () => {
		jest.restoreAllMocks();
	});

	describe('pingDatabase', () => {
		it('returns true when SELECT 1 succeeds', async () => {
			jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
			await expect(service.pingDatabase()).resolves.toBe(true);
		});

		it('returns false when SELECT 1 throws connection error', async () => {
			jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('Connection refused'));
			await expect(service.pingDatabase()).resolves.toBe(false);
		});

		it('returns false when SELECT 1 throws timeout error', async () => {
			jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('timeout expired'));
			await expect(service.pingDatabase()).resolves.toBe(false);
		});

		it('does not rethrow database errors', async () => {
			jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED'));
			await expect(service.pingDatabase()).resolves.toBe(false);
		});
	});

	describe('appliedMigrationCount', () => {
		it('returns the COUNT(*) from the tracking table', async () => {
			jest.spyOn(service, '$queryRawUnsafe').mockResolvedValue([{ n: 12 }]);
			await expect(service.appliedMigrationCount()).resolves.toBe(12);
		});

		it('coerces a bigint count to a number', async () => {
			jest.spyOn(service, '$queryRawUnsafe').mockResolvedValue([{ n: 7n }]);
			await expect(service.appliedMigrationCount()).resolves.toBe(7);
		});

		it('returns 0 when the tracking table is missing (query throws)', async () => {
			jest
				.spyOn(service, '$queryRawUnsafe')
				.mockRejectedValue(new Error('no such table: __app_migrations'));
			await expect(service.appliedMigrationCount()).resolves.toBe(0);
		});

		it('returns 0 when the result set is empty', async () => {
			jest.spyOn(service, '$queryRawUnsafe').mockResolvedValue([]);
			await expect(service.appliedMigrationCount()).resolves.toBe(0);
		});
	});

	describe('constructor adapter wiring', () => {
		it('accepts the legacy { datasources: { db: { url } } } shape', () => {
			expect(
				() => new PrismaService({ datasources: { db: { url: 'file:/tmp/nestidp-ds.db' } } }),
			).not.toThrow();
		});

		it('accepts an explicit url + encryptionKey', () => {
			expect(
				() => new PrismaService({ url: 'file:/tmp/nestidp-enc.db', encryptionKey: 'k' }),
			).not.toThrow();
		});
	});

	describe('onModuleDestroy', () => {
		it('disconnects prisma client on shutdown', async () => {
			const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
			await service.onModuleDestroy();
			expect(disconnect).toHaveBeenCalledTimes(1);
		});
	});
});
