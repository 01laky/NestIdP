import { PrismaService } from '@api/prisma/services/prisma.service';

describe('PrismaService', () => {
	let service: PrismaService;

	beforeEach(() => {
		service = new PrismaService();
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

	describe('onModuleDestroy', () => {
		it('disconnects prisma client on shutdown', async () => {
			const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
			await service.onModuleDestroy();
			expect(disconnect).toHaveBeenCalledTimes(1);
		});
	});
});
