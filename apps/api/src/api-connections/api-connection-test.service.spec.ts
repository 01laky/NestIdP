import { Logger, NotFoundException } from '@nestjs/common';
import { ApiConnectionTestService } from './api-connection-test.service';
import type { CredentialsEncryptionPort } from '../encryption/credentials-encryption.port';

describe('ApiConnectionTestService', () => {
	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn(),
		decrypt: jest.fn().mockReturnValue('plain-bearer-token'),
	};

	const prisma = {
		apiConnection: {
			findUnique: jest.fn(),
		},
	};

	const service = new ApiConnectionTestService(prisma as never, encryption);

	const connection = {
		id: 'c1234567890123456789012345',
		name: 'Test',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER' as const,
		authCredentialsEncrypted: 'enc',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER' as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	beforeEach(() => {
		jest.clearAllMocks();
		encryption.decrypt.mockReturnValue('plain-bearer-token');
		prisma.apiConnection.findUnique.mockResolvedValue(connection);
	});

	it('API-CON-TST-01: external 200 → ok true, reachable true, statusCode 200', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: true, reachable: true, statusCode: 200 });
	});

	it('API-CON-TST-02: external 401 → ok false, reachable true, statusCode 401', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 401,
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: false, reachable: true, statusCode: 401 });
	});

	it('API-CON-TST-03: fetch throws → ok false, reachable false', async () => {
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: false, reachable: false });
	});

	it('API-CON-TST-04: request URL is baseUrl/users?limit=1 with Authorization header', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);

		await service.testConnection(connection.id);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL('/users?limit=1', 'https://identity.example.com').toString(),
			expect.objectContaining({
				method: 'GET',
				headers: { Authorization: 'Bearer plain-bearer-token' },
			}),
		);
	});

	it('API-CON-TST-06: unknown connection id → 404', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.testConnection('missing')).rejects.toThrow(NotFoundException);
	});

	it('API-CON-TST-07: timeout → ok false, reachable false, timed out message', async () => {
		const timeoutError = Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
		jest.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			message: 'Identity API request timed out',
		});
	});

	it('API-CON-TST-08: decrypt failure → ok false without throwing', async () => {
		encryption.decrypt.mockImplementation(() => {
			throw new Error('bad ciphertext');
		});

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			message: 'Stored credentials could not be decrypted',
		});
	});

	it('API-CON-TST-09: external HTTP 500 → ok false but reachable', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: true,
			statusCode: 500,
		});
	});

	it('API-CON-TST-10: logger never receives full bearer token', async () => {
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		encryption.decrypt.mockReturnValue('abcdefghijklmnop-token-value');
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

		await service.testConnection(connection.id);

		for (const call of warnSpy.mock.calls) {
			const joined = call.join(' ');
			expect(joined).not.toContain('abcdefghijklmnop-token-value');
		}
		warnSpy.mockRestore();
	});

	it('API-CON-TST-11: baseUrl with path joins /users correctly', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...connection,
			baseUrl: 'https://identity.example.com/api/v1',
		});
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);

		await service.testConnection(connection.id);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL('/users?limit=1', 'https://identity.example.com/api/v1').toString(),
			expect.any(Object),
		);
	});
});
