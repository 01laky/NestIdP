import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ApiConnectionsService } from './api-connections.service';
import type { CredentialsEncryptionPort } from '../encryption/credentials-encryption.port';

describe('ApiConnectionsService', () => {
	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn((value: string) => `enc:${value}`),
		decrypt: jest.fn(),
	};

	const prisma = {
		apiConnection: {
			count: jest.fn(),
			findMany: jest.fn(),
			findUnique: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
	};

	const configService = {
		get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : undefined)),
	} as unknown as ConfigService;

	const audit = {
		logCreated: jest.fn(),
		logUpdated: jest.fn(),
		logDeleted: jest.fn(),
	};
	const service = new ApiConnectionsService(
		prisma as never,
		encryption,
		configService,
		audit as never,
	);

	const sampleRow = {
		id: 'c1234567890123456789012345',
		name: 'Corp API',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER' as const,
		authCredentialsEncrypted: 'enc:secret',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER' as const,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};

	beforeEach(() => {
		jest.clearAllMocks();
		prisma.apiConnection.count.mockResolvedValue(0);
		prisma.apiConnection.findMany.mockResolvedValue([]);
	});

	it('API-CON-01: create encrypts token; DTO has hasBearerToken true, no secret fields', async () => {
		prisma.apiConnection.create.mockResolvedValue(sampleRow);

		const result = await service.create({
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret-token',
		});

		expect(encryption.encrypt).toHaveBeenCalledWith('secret-token');
		expect(result.connection.hasBearerToken).toBe(true);
		expect(result.connection).not.toHaveProperty('bearerToken');
		expect(result.connection).not.toHaveProperty('authCredentialsEncrypted');
	});

	it('API-CON-02: create normalizes baseUrl trailing slash', async () => {
		prisma.apiConnection.create.mockResolvedValue({
			...sampleRow,
			baseUrl: 'https://identity.example.com/api',
		});

		await service.create({
			name: 'Corp API',
			baseUrl: 'https://identity.example.com/api/',
			bearerToken: 'token',
		});

		expect(prisma.apiConnection.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					baseUrl: 'https://identity.example.com/api',
				}),
			}),
		);
	});

	it('API-CON-03: create rejects invalid URL', async () => {
		await expect(
			service.create({ name: 'X', baseUrl: 'not-url', bearerToken: 't' }),
		).rejects.toThrow(BadRequestException);
	});

	it('API-CON-04: create rejects http baseUrl when NODE_ENV production', async () => {
		const getMock = configService.get as jest.Mock;
		getMock.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'production' : undefined));

		await expect(
			service.create({
				name: 'X',
				baseUrl: 'http://identity.example.com',
				bearerToken: 't',
			}),
		).rejects.toThrow(BadRequestException);

		getMock.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'test' : undefined));
	});

	it('API-CON-05: create second external connection → ConflictException', async () => {
		prisma.apiConnection.count.mockResolvedValue(1);

		await expect(
			service.create({
				name: 'Second',
				baseUrl: 'https://b.example.com',
				bearerToken: 't',
			}),
		).rejects.toThrow(ConflictException);

		expect(prisma.apiConnection.count).toHaveBeenCalledWith({
			where: { isLocalDirectory: false },
		});
	});

	it('API-CON-05b: create allowed when only local directory row exists', async () => {
		prisma.apiConnection.count.mockResolvedValue(0);
		prisma.apiConnection.create.mockResolvedValue(sampleRow);

		await service.create({
			name: 'Mock API',
			baseUrl: 'http://localhost:4010',
			bearerToken: 'mock-sync-dev-token',
		});

		expect(prisma.apiConnection.count).toHaveBeenCalledWith({
			where: { isLocalDirectory: false },
		});
	});

	it('API-CON-06: update changes name only; token unchanged', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
		prisma.apiConnection.update.mockResolvedValue({ ...sampleRow, name: 'Renamed' });

		await service.update(sampleRow.id, { name: 'Renamed' });

		expect(encryption.encrypt).not.toHaveBeenCalled();
	});

	it('API-CON-07: update with new bearerToken re-encrypts', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
		prisma.apiConnection.update.mockResolvedValue(sampleRow);

		await service.update(sampleRow.id, { bearerToken: 'new-token' });

		expect(encryption.encrypt).toHaveBeenCalledWith('new-token');
	});

	it('API-CON-08: update empty body → BadRequestException', async () => {
		await expect(service.update(sampleRow.id, {})).rejects.toThrow(BadRequestException);
	});

	it('API-CON-09: delete connection with User child → conflict', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.delete.mockRejectedValue(
			new Prisma.PrismaClientKnownRequestError('FK', {
				code: 'P2003',
				clientVersion: 'test',
			}),
		);

		await expect(service.delete(sampleRow.id)).rejects.toThrow(ConflictException);
	});

	it('API-CON-10: delete connection without children → success', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.delete.mockResolvedValue(sampleRow);

		await expect(service.delete(sampleRow.id)).resolves.toEqual({
			ok: true,
			id: sampleRow.id,
		});
	});

	it('API-CON-11: getById not found → NotFoundException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
	});

	it('API-CON-12: list returns empty array when no connections', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([]);
		await expect(service.list()).resolves.toEqual({ connections: [] });
	});

	it('API-CON-14: create with duplicate name (case-insensitive) → ConflictException', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([{ id: 'other', name: 'Corp API' }]);

		await expect(
			service.create({
				name: 'corp api',
				baseUrl: 'https://identity.example.com',
				bearerToken: 't',
			}),
		).rejects.toThrow(ConflictException);
	});

	it('API-CON-13: create never persists plaintext bearerToken in DB payload', async () => {
		prisma.apiConnection.create.mockResolvedValue(sampleRow);
		const plaintext = 'super-secret-plaintext-token';

		await service.create({
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			bearerToken: plaintext,
		});

		const data = prisma.apiConnection.create.mock.calls[0][0].data;
		expect(data).not.toHaveProperty('bearerToken');
		expect(data.authCredentialsEncrypted).not.toBe(plaintext);
		expect(data.authCredentialsEncrypted).toBe(`enc:${plaintext}`);
	});

	it('API-CON-15: update empty name → BadRequestException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		await expect(service.update(sampleRow.id, { name: '   ' })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-CON-16: update empty bearerToken → BadRequestException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		await expect(service.update(sampleRow.id, { bearerToken: '' })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-CON-17: update rename to duplicate name → ConflictException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.findMany.mockResolvedValue([
			sampleRow,
			{ id: 'other-id', name: 'Taken Name' },
		]);

		await expect(service.update(sampleRow.id, { name: 'taken name' })).rejects.toThrow(
			ConflictException,
		);
	});

	it('API-CON-18: update allows keeping same name (excludes self from duplicate check)', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.findMany.mockResolvedValue([]);
		prisma.apiConnection.update.mockResolvedValue(sampleRow);

		await expect(service.update(sampleRow.id, { name: 'Corp API' })).resolves.toBeDefined();
	});

	it('API-CON-19: update invalid baseUrl → BadRequestException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		await expect(service.update(sampleRow.id, { baseUrl: 'bad-url' })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-CON-20: delete not found → NotFoundException', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
	});

	it('API-CON-21: list orders by createdAt asc', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
		await service.list();
		expect(prisma.apiConnection.findMany).toHaveBeenCalledWith({
			where: { isLocalDirectory: false },
			orderBy: { createdAt: 'asc' },
		});
	});

	it('API-CON-22: create trims name whitespace', async () => {
		prisma.apiConnection.create.mockResolvedValue(sampleRow);
		await service.create({
			name: '  Corp API  ',
			baseUrl: 'https://identity.example.com',
			bearerToken: 't',
		});
		expect(prisma.apiConnection.create.mock.calls[0][0].data.name).toBe('Corp API');
	});
});
