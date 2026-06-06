import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ApiConnectionsService } from '@api/api-connections/services/api-connections.service';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';

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
		logContractUpdated: jest.fn(),
		logAuthTypeChanged: jest.fn(),
	};
	const oauthTokenService = {
		getAccessToken: jest.fn(),
		getLastTokenAt: jest.fn().mockReturnValue(null),
		fetchDiagnostics: jest.fn(),
	};

	const service = new ApiConnectionsService(
		prisma as never,
		encryption,
		configService,
		audit as never,
		oauthTokenService as never,
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

	it('API-APICONN-CONTRACT-01: create stores a valid apiContractConfig', async () => {
		prisma.apiConnection.create.mockResolvedValue(sampleRow);
		await service.create({
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			bearerToken: 't',
			apiContractConfig: { endpoints: { usersPath: '/v1/accounts' } },
		});
		expect(prisma.apiConnection.create.mock.calls[0][0].data.apiContractConfig).toMatchObject({
			endpoints: { usersPath: '/v1/accounts' },
		});
	});

	it('API-APICONN-CONTRACT-02: invalid contract on create → 400', async () => {
		await expect(
			service.create({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 't',
				apiContractConfig: { endpoints: { usersPath: 'https://evil/users' } },
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('API-APICONN-CONTRACT-03: update with apiContractConfig: null clears to default (JsonNull) + audits', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.update.mockResolvedValue(sampleRow);
		await service.update(sampleRow.id, { apiContractConfig: null });
		expect(prisma.apiConnection.update.mock.calls[0][0].data.apiContractConfig).toBe(
			Prisma.JsonNull,
		);
		expect(audit.logContractUpdated).toHaveBeenCalledWith(sampleRow.id, sampleRow.name, ['reset']);
	});

	it('API-APICONN-CONTRACT-04: update with invalid contract → 400', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		await expect(
			service.update(sampleRow.id, { apiContractConfig: { onRowError: 'nope' } as never }),
		).rejects.toThrow(BadRequestException);
	});

	it('API-APICONN-CONTRACT-05: create with explicit null contract stores JsonNull', async () => {
		prisma.apiConnection.create.mockResolvedValue(sampleRow);
		await service.create({
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			bearerToken: 't',
			apiContractConfig: null,
		});
		expect(prisma.apiConnection.create.mock.calls[0][0].data.apiContractConfig).toBe(
			Prisma.JsonNull,
		);
	});

	it('API-APICONN-CONTRACT-06: getById round-trips the stored contract via the DTO', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...sampleRow,
			apiContractConfig: { endpoints: { usersPath: '/v1/accounts' } },
		});
		const result = await service.getById(sampleRow.id);
		expect(result.connection.apiContractConfig).toEqual({
			endpoints: { usersPath: '/v1/accounts' },
		});
	});

	// --- OAuth 2.0 Client Credentials ---
	const oauthRow = {
		...sampleRow,
		authType: 'OAUTH2_CLIENT_CREDENTIALS' as const,
		authCredentialsEncrypted: '',
		oauthTokenUrl: 'https://idp.example.com/oauth/token',
		oauthClientId: 'client-1',
		oauthClientSecretEncrypted: 'enc:old-secret',
		oauthScope: null,
		oauthAudience: null,
		oauthClientAuthMethod: 'client_secret_post',
		oauthTokenRequestParams: null,
	};

	it('OAUTH-CRUD-01: create OAuth encrypts the secret; secret never returned', async () => {
		prisma.apiConnection.create.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				...oauthRow,
				...data,
			}),
		);
		const result = await service.create({
			name: 'OAuth API',
			baseUrl: 'https://identity.example.com',
			authType: 'OAUTH2_CLIENT_CREDENTIALS',
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthClientSecret: 'the-secret',
		});
		expect(encryption.encrypt).toHaveBeenCalledWith('the-secret');
		const data = prisma.apiConnection.create.mock.calls[0][0].data;
		expect(data.authType).toBe('OAUTH2_CLIENT_CREDENTIALS');
		expect(data.authCredentialsEncrypted).toBe('');
		expect(data.oauthClientSecretEncrypted).toBe('enc:the-secret');
		expect(result.connection.hasOauthClientSecret).toBe(true);
		expect(JSON.stringify(result.connection)).not.toContain('the-secret');
	});

	it('OAUTH-CRUD-02: create OAuth without secret → 400', async () => {
		await expect(
			service.create({
				name: 'OAuth API',
				baseUrl: 'https://identity.example.com',
				authType: 'OAUTH2_CLIENT_CREDENTIALS',
				oauthTokenUrl: 'https://idp.example.com/oauth/token',
				oauthClientId: 'client-1',
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('OAUTH-CRUD-03: create OAuth with bad token URL → 400', async () => {
		await expect(
			service.create({
				name: 'OAuth API',
				baseUrl: 'https://identity.example.com',
				authType: 'OAUTH2_CLIENT_CREDENTIALS',
				oauthTokenUrl: 'not-a-url',
				oauthClientId: 'client-1',
				oauthClientSecret: 's',
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('OAUTH-CRUD-04: update without secret keeps the existing one', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthRow);
		prisma.apiConnection.update.mockResolvedValue(oauthRow);
		await service.update(oauthRow.id, {
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-2',
		});
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data).not.toHaveProperty('oauthClientSecretEncrypted');
		expect(data.oauthClientId).toBe('client-2');
	});

	it('OAUTH-CRUD-05: update with a new secret re-encrypts it', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthRow);
		prisma.apiConnection.update.mockResolvedValue(oauthRow);
		await service.update(oauthRow.id, {
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthClientSecret: 'rotated',
		});
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.oauthClientSecretEncrypted).toBe('enc:rotated');
	});

	it('OAUTH-CRUD-06: switching BEARER → OAUTH requires the OAuth fields', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		await expect(
			service.update(sampleRow.id, { authType: 'OAUTH2_CLIENT_CREDENTIALS' }),
		).rejects.toThrow(BadRequestException);
	});

	it('OAUTH-CRUD-07: switching BEARER → OAUTH audits the auth-type change', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.apiConnection.update.mockResolvedValue(oauthRow);
		await service.update(sampleRow.id, {
			authType: 'OAUTH2_CLIENT_CREDENTIALS',
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthClientSecret: 'secret',
		});
		expect(audit.logAuthTypeChanged).toHaveBeenCalledWith(
			oauthRow.id,
			oauthRow.name,
			'OAUTH2_CLIENT_CREDENTIALS',
		);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.authCredentialsEncrypted).toBe('');
	});

	it('OAUTH-CRUD-08: switching OAUTH → BEARER requires bearerToken and clears OAuth fields', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthRow);
		await expect(service.update(oauthRow.id, { authType: 'BEARER' })).rejects.toThrow(
			BadRequestException,
		);

		prisma.apiConnection.update.mockResolvedValue(sampleRow);
		await service.update(oauthRow.id, { authType: 'BEARER', bearerToken: 'new-token' });
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.authCredentialsEncrypted).toBe('enc:new-token');
		expect(data.oauthTokenUrl).toBeNull();
		expect(data.oauthClientSecretEncrypted).toBeNull();
	});

	it('OAUTH-CRUD-09: getById round-trips non-secret OAuth fields + hasOauthClientSecret', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthRow);
		const result = await service.getById(oauthRow.id);
		expect(result.connection.oauthTokenUrl).toBe('https://idp.example.com/oauth/token');
		expect(result.connection.oauthClientId).toBe('client-1');
		expect(result.connection.hasOauthClientSecret).toBe(true);
		expect(result.connection).not.toHaveProperty('oauthClientSecretEncrypted');
	});

	it('OAUTH-CRUD-10: BEARER create ignores stray OAuth fields (not persisted)', async () => {
		prisma.apiConnection.create.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				...sampleRow,
				...data,
			}),
		);
		await service.create({
			name: 'Bearer API',
			baseUrl: 'https://identity.example.com',
			authType: 'BEARER',
			bearerToken: 'tok',
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'should-ignore',
			oauthClientSecret: 'should-ignore',
		});
		const data = prisma.apiConnection.create.mock.calls[0][0].data;
		expect(data.authType).toBe('BEARER');
		expect(data.authCredentialsEncrypted).toBe('enc:tok');
		expect(data.oauthTokenUrl).toBeUndefined();
		expect(data.oauthClientSecretEncrypted).toBeUndefined();
	});

	it('OAUTH-CRUD-11: invalid client auth method → 400', async () => {
		await expect(
			service.create({
				name: 'OAuth API',
				baseUrl: 'https://identity.example.com',
				authType: 'OAUTH2_CLIENT_CREDENTIALS',
				oauthTokenUrl: 'https://idp.example.com/oauth/token',
				oauthClientId: 'client-1',
				oauthClientSecret: 's',
				oauthClientAuthMethod: 'private_key_jwt' as never,
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('OAUTH-CRUD-12: reserved extra token param → 400', async () => {
		await expect(
			service.create({
				name: 'OAuth API',
				baseUrl: 'https://identity.example.com',
				authType: 'OAUTH2_CLIENT_CREDENTIALS',
				oauthTokenUrl: 'https://idp.example.com/oauth/token',
				oauthClientId: 'client-1',
				oauthClientSecret: 's',
				oauthTokenRequestParams: { grant_type: 'evil' },
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('OAUTH-CRUD-13: OAUTH → OAUTH scope change keeps secret + does NOT audit auth-type change', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthRow);
		prisma.apiConnection.update.mockResolvedValue(oauthRow);
		await service.update(oauthRow.id, {
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthScope: 'read write',
		});
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.oauthScope).toBe('read write');
		expect(data).not.toHaveProperty('oauthClientSecretEncrypted');
		expect(audit.logAuthTypeChanged).not.toHaveBeenCalled();
	});

	it('OAUTH-CRUD-14: list enriches OAuth rows with oauthLastTokenAt from the token service', async () => {
		oauthTokenService.getLastTokenAt.mockReturnValue('2026-06-09T10:00:00.000Z');
		prisma.apiConnection.findMany.mockResolvedValue([oauthRow]);
		const result = await service.list();
		expect(result.connections[0].oauthLastTokenAt).toBe('2026-06-09T10:00:00.000Z');
		expect(oauthTokenService.getLastTokenAt).toHaveBeenCalledWith(oauthRow.id);
	});
});
