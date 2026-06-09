import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ApiConnectionsService } from '@api/api-connections/services/api-connections.service';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';
import { fakeProxyDispatcher } from '@test/support/proxy-dispatcher.mock';

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
		logProxyUpdated: jest.fn(),
		logSourceIdentitiesRemoved: jest.fn(),
	};
	const oauthTokenService = {
		getAccessToken: jest.fn(),
		getLastTokenAt: jest.fn().mockReturnValue(null),
		fetchDiagnostics: jest.fn(),
	};

	const identityStore = {
		connectionHasIdentityRows: jest.fn().mockResolvedValue(false),
		countsByConnection: jest.fn().mockResolvedValue({ users: {}, groups: {}, roles: {} }),
		syncedUserIdsForConnection: jest.fn().mockResolvedValue([]),
		removeConnectionIdentities: jest
			.fn()
			.mockResolvedValue({ usersRemoved: 0, groupsRemoved: 0, rolesRemoved: 0 }),
	};

	const ssoSessions = {
		terminateAllForUser: jest.fn().mockResolvedValue(0),
	};

	const proxyDispatcher = fakeProxyDispatcher();
	const service = new ApiConnectionsService(
		prisma as never,
		encryption,
		configService,
		audit as never,
		oauthTokenService as never,
		identityStore as never,
		proxyDispatcher,
		ssoSessions as never,
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

	it('API-CON-05 / MAS: multiple external connections are allowed (Prompt 37)', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
		prisma.apiConnection.create.mockResolvedValue({ ...sampleRow, id: 'conn-2', name: 'Second' });

		const res = await service.create({
			name: 'Second',
			baseUrl: 'https://b.example.com',
			bearerToken: 't',
		});

		expect(res.connection.name).toBe('Second');
		expect(prisma.apiConnection.create).toHaveBeenCalled();
	});

	it('API-CON-05b: create allowed', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([]);
		prisma.apiConnection.create.mockResolvedValue(sampleRow);

		await service.create({
			name: 'Mock API',
			baseUrl: 'http://localhost:4010',
			bearerToken: 'mock-sync-dev-token',
		});

		expect(prisma.apiConnection.create).toHaveBeenCalled();
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

	it('API-CON-10b: delete blocked by cross-store guard when identity rows exist in the active store', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
		identityStore.connectionHasIdentityRows.mockResolvedValueOnce(true);
		await expect(service.delete(sampleRow.id)).rejects.toThrow(ConflictException);
		// the DB delete must not even be attempted (the local FK cannot see external rows)
		expect(prisma.apiConnection.delete).not.toHaveBeenCalled();
		expect(identityStore.connectionHasIdentityRows).toHaveBeenCalledWith(sampleRow.id);
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

	describe('outbound proxy config', () => {
		const proxyRow = {
			...sampleRow,
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPasswordEncrypted: 'enc:psecret',
			noProxyHosts: '.corp.example',
		};

		it('PROXY-API-01: create persists valid proxy config; DTO exposes non-secret state, never the password', async () => {
			prisma.apiConnection.create.mockResolvedValue(proxyRow);
			const result = await service.create({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'tok',
				proxyEnabled: true,
				proxyUrl: 'http://proxy.corp.example:8080',
				proxyUsername: 'puser',
				proxyPassword: 'psecret',
				noProxyHosts: '.corp.example',
			});
			expect(encryption.encrypt).toHaveBeenCalledWith('psecret');
			const data = prisma.apiConnection.create.mock.calls[0][0].data;
			expect(data.proxyPasswordEncrypted).toBe('enc:psecret');
			expect(data.proxyUrl).toBe('http://proxy.corp.example:8080');
			expect(result.connection).toMatchObject({
				proxyEnabled: true,
				proxyUrl: 'http://proxy.corp.example:8080',
				proxyUsername: 'puser',
				hasProxyPassword: true,
				noProxyHosts: '.corp.example',
			});
			expect(result.connection).not.toHaveProperty('proxyPassword');
			expect(result.connection).not.toHaveProperty('proxyPasswordEncrypted');
			expect(audit.logProxyUpdated).toHaveBeenCalled();
		});

		it('PROXY-API-02a: proxyEnabled=true without a proxyUrl → 400', async () => {
			await expect(
				service.create({
					name: 'X',
					baseUrl: 'https://identity.example.com',
					bearerToken: 't',
					proxyEnabled: true,
				}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('PROXY-API-02b: invalid proxy URL scheme → 400', async () => {
			await expect(
				service.create({
					name: 'X',
					baseUrl: 'https://identity.example.com',
					bearerToken: 't',
					proxyEnabled: true,
					proxyUrl: 'socks5://proxy:1080',
				}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('PROXY-API-02c: empty proxyPassword → 400', async () => {
			await expect(
				service.create({
					name: 'X',
					baseUrl: 'https://identity.example.com',
					bearerToken: 't',
					proxyEnabled: true,
					proxyUrl: 'http://proxy:8080',
					proxyPassword: '',
				}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('PROXY-API-02d: update omits proxyPassword keeps stored; null clears it', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));

			// omit → no password write
			await service.update(proxyRow.id, { proxyUsername: 'newuser' });
			let data = prisma.apiConnection.update.mock.calls[0][0].data;
			expect(data).not.toHaveProperty('proxyPasswordEncrypted');

			// null → cleared
			await service.update(proxyRow.id, { proxyPassword: null });
			data = prisma.apiConnection.update.mock.calls[1][0].data;
			expect(data.proxyPasswordEncrypted).toBeNull();
		});

		it('PROXY-API-03: proxy password is encrypted at rest (stored ≠ plaintext)', async () => {
			prisma.apiConnection.create.mockResolvedValue(proxyRow);
			await service.create({
				name: 'Corp API',
				baseUrl: 'https://identity.example.com',
				bearerToken: 'tok',
				proxyEnabled: true,
				proxyUrl: 'http://proxy:8080',
				proxyPassword: 'psecret',
			});
			const data = prisma.apiConnection.create.mock.calls[0][0].data;
			expect(data.proxyPasswordEncrypted).not.toBe('psecret');
			expect(data.proxyPasswordEncrypted).toBe('enc:psecret');
		});

		it('PROXY-API-04a: a proxy-only update is accepted (not rejected by the "at least one field" guard)', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await expect(service.update(proxyRow.id, { noProxyHosts: 'a.com' })).resolves.toBeDefined();
		});

		it('PROXY-API-04b: a proxy-config change invalidates the cached dispatcher; so does delete', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await service.update(proxyRow.id, { proxyEnabled: false });
			expect(proxyDispatcher.invalidate).toHaveBeenCalledWith(proxyRow.id);

			(proxyDispatcher.invalidate as jest.Mock).mockClear();
			prisma.apiConnection.delete.mockResolvedValue(proxyRow);
			await service.delete(proxyRow.id);
			expect(proxyDispatcher.invalidate).toHaveBeenCalledWith(proxyRow.id);
		});
	});

	describe('outbound proxy config — extended', () => {
		const proxyRow = {
			...sampleRow,
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPasswordEncrypted: 'enc:psecret',
			noProxyHosts: '.corp.example',
		};

		it('PROXY-API-EXT-01: create with proxy URL but disabled stores both, no "url required" error', async () => {
			prisma.apiConnection.create.mockResolvedValue({ ...proxyRow, proxyEnabled: false });
			await service.create({
				name: 'X',
				baseUrl: 'https://identity.example.com',
				bearerToken: 't',
				proxyEnabled: false,
				proxyUrl: 'http://proxy.corp.example:8080',
			});
			const data = prisma.apiConnection.create.mock.calls[0][0].data;
			expect(data.proxyEnabled).toBe(false);
			expect(data.proxyUrl).toBe('http://proxy.corp.example:8080');
		});

		it('PROXY-API-EXT-02: enabling proxy when a URL is already stored is accepted (no 400)', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...proxyRow, proxyEnabled: false });
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await expect(service.update(proxyRow.id, { proxyEnabled: true })).resolves.toBeDefined();
		});

		it('PROXY-API-EXT-03: clearing proxyUrl ("") while proxy stays enabled → 400', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			await expect(service.update(proxyRow.id, { proxyUrl: '' })).rejects.toBeInstanceOf(
				BadRequestException,
			);
		});

		it('PROXY-API-EXT-04: proxyUsername null clears it; whitespace noProxyHosts → null', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await service.update(proxyRow.id, { proxyUsername: null, noProxyHosts: '   ' });
			const data = prisma.apiConnection.update.mock.calls[0][0].data;
			expect(data.proxyUsername).toBeNull();
			expect(data.noProxyHosts).toBeNull();
		});

		it('PROXY-API-EXT-05: a name-only update neither invalidates the dispatcher nor audits proxy', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.findMany.mockResolvedValue([proxyRow]);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await service.update(proxyRow.id, { name: 'Renamed' });
			expect(proxyDispatcher.invalidate).not.toHaveBeenCalled();
			expect(audit.logProxyUpdated).not.toHaveBeenCalled();
		});

		it('PROXY-API-EXT-06: the proxy audit captures host + auth flags, never credentials', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(proxyRow);
			prisma.apiConnection.update.mockImplementation(async ({ data }) => ({
				...proxyRow,
				...data,
			}));
			await service.update(proxyRow.id, { noProxyHosts: '.x' });
			expect(audit.logProxyUpdated).toHaveBeenCalledWith(
				proxyRow.id,
				proxyRow.name,
				expect.objectContaining({ enabled: true, hasAuth: true, hasNoProxy: true }),
			);
			const detailArg = (audit.logProxyUpdated as jest.Mock).mock.calls[0][2];
			expect(JSON.stringify(detailArg)).not.toMatch(/psecret/);
		});

		it('PROXY-API-EXT-07: a normalized proxy URL is persisted (host lowercased)', async () => {
			prisma.apiConnection.create.mockResolvedValue(proxyRow);
			await service.create({
				name: 'X',
				baseUrl: 'https://identity.example.com',
				bearerToken: 't',
				proxyEnabled: true,
				proxyUrl: 'http://Proxy.CORP.Example:8080',
			});
			const data = prisma.apiConnection.create.mock.calls[0][0].data;
			expect(data.proxyUrl).toBe('http://proxy.corp.example:8080');
		});

		it('PROXY-API-EXT-08: enabling proxy with neither a new nor a stored URL → 400', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...sampleRow, proxyUrl: null });
			await expect(service.update(sampleRow.id, { proxyEnabled: true })).rejects.toBeInstanceOf(
				BadRequestException,
			);
		});
	});

	describe('multi-source (Prompt 37)', () => {
		beforeEach(() => {
			jest.clearAllMocks();
			identityStore.connectionHasIdentityRows.mockResolvedValue(false);
			identityStore.syncedUserIdsForConnection.mockResolvedValue([]);
			identityStore.removeConnectionIdentities.mockResolvedValue({
				usersRemoved: 0,
				groupsRemoved: 0,
				rolesRemoved: 0,
			});
			ssoSessions.terminateAllForUser.mockResolvedValue(0);
		});

		it('MAS-CREATE: create persists includeInSyncAll + usernameCollisionPolicy', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([]);
			prisma.apiConnection.create.mockResolvedValue(sampleRow);
			await service.create({
				name: 'C',
				baseUrl: 'https://c.example.com',
				bearerToken: 't',
				includeInSyncAll: false,
				usernameCollisionPolicy: 'fail_run',
			});
			const data = prisma.apiConnection.create.mock.calls[0][0].data;
			expect(data.includeInSyncAll).toBe(false);
			expect(data.usernameCollisionPolicy).toBe('fail_run');
		});

		it('MAS-UPDATE: update sets includeInSyncAll + usernameCollisionPolicy', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
			prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
			prisma.apiConnection.update.mockResolvedValue(sampleRow);
			await service.update(sampleRow.id, {
				includeInSyncAll: false,
				usernameCollisionPolicy: 'skip',
			});
			const data = prisma.apiConnection.update.mock.calls[0][0].data;
			expect(data.includeInSyncAll).toBe(false);
			expect(data.usernameCollisionPolicy).toBe('skip');
		});

		it('MAS-REBIND-01: changing baseUrl with existing identities and no acknowledgement → 409', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
			identityStore.connectionHasIdentityRows.mockResolvedValue(true);
			await expect(
				service.update(sampleRow.id, { baseUrl: 'https://moved.example.com' }),
			).rejects.toBeInstanceOf(ConflictException);
		});

		it('MAS-REBIND-02: re-bind proceeds with acknowledgeRebind=true', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
			prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
			identityStore.connectionHasIdentityRows.mockResolvedValue(true);
			prisma.apiConnection.update.mockResolvedValue(sampleRow);
			await expect(
				service.update(sampleRow.id, {
					baseUrl: 'https://moved.example.com',
					acknowledgeRebind: true,
				}),
			).resolves.toBeDefined();
		});

		it('MAS-REBIND-03: changing only non-rebind fields with identities does not require acknowledgement', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
			prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
			identityStore.connectionHasIdentityRows.mockResolvedValue(true);
			prisma.apiConnection.update.mockResolvedValue(sampleRow);
			await expect(service.update(sampleRow.id, { name: 'Renamed' })).resolves.toBeDefined();
		});

		it('MAS-REMOVE-01: removeSourceIdentities terminates each user’s sessions and returns counts', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...sampleRow, isLocalDirectory: false });
			identityStore.syncedUserIdsForConnection.mockResolvedValue(['u1', 'u2']);
			identityStore.removeConnectionIdentities.mockResolvedValue({
				usersRemoved: 2,
				groupsRemoved: 1,
				rolesRemoved: 0,
			});
			ssoSessions.terminateAllForUser.mockResolvedValue(1);

			const res = await service.removeSourceIdentities(sampleRow.id, 'delete');

			expect(ssoSessions.terminateAllForUser).toHaveBeenCalledTimes(2);
			expect(ssoSessions.terminateAllForUser).toHaveBeenCalledWith('u1', 'user_deactivated');
			expect(identityStore.removeConnectionIdentities).toHaveBeenCalledWith(sampleRow.id, 'delete');
			expect(res).toEqual({
				ok: true,
				mode: 'delete',
				usersRemoved: 2,
				groupsRemoved: 1,
				rolesRemoved: 0,
				sessionsTerminated: 2,
			});
			expect(audit.logSourceIdentitiesRemoved).toHaveBeenCalled();
		});

		it('MAS-REMOVE-02: the local-directory connection’s identities cannot be removed this way', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue({ ...sampleRow, isLocalDirectory: true });
			// findOrThrow rejects the local-directory connection up front (Forbidden), never deleting identities.
			await expect(service.removeSourceIdentities(sampleRow.id, 'delete')).rejects.toBeInstanceOf(
				ForbiddenException,
			);
		});

		it('MAS-DELGUARD: deleting a connection with identities is blocked (409)', async () => {
			prisma.apiConnection.findUnique.mockResolvedValue(sampleRow);
			identityStore.connectionHasIdentityRows.mockResolvedValue(true);
			await expect(service.delete(sampleRow.id)).rejects.toBeInstanceOf(ConflictException);
		});

		it('MAS-LIST-COUNTS: list attaches per-source synced counts', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([sampleRow]);
			identityStore.countsByConnection.mockResolvedValue({
				users: { [sampleRow.id]: 5 },
				groups: { [sampleRow.id]: 2 },
				roles: {},
			});
			const res = await service.list();
			expect(res.connections[0].syncedUserCount).toBe(5);
			expect(res.connections[0].syncedGroupCount).toBe(2);
			expect(res.connections[0].syncedRoleCount).toBe(0);
		});
	});
});
