import { PrismaClient } from '@prisma/client';
import { DEFAULT_PASSWORD_HASH_ALGORITHM } from '@nestidp/shared';
import {
	createTestAdminUser,
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestGroup,
	createTestIdpSettings,
	createTestIdpSettingsWithSigningKey,
	buildTestAuthnRequestRedirectPayload,
	createTestRole,
	createTestSamlSession,
	createTestSpConnection,
	createTestSyncLog,
	createTestUser,
	createTestUserWithPassword,
	TEST_ENCRYPTED_CREDENTIALS,
	TEST_PASSWORD_HASH,
} from '@test/support/prisma/test-fixtures';

describe('test-fixtures', () => {
	it('API-FIX-01: createTestApiConnection sets required fields including encrypted credentials', async () => {
		const prisma = {
			apiConnection: {
				create: jest.fn().mockResolvedValue({ id: 'conn-1' }),
			},
		};

		await createTestApiConnection(prisma as unknown as PrismaClient, {
			name: 'Custom',
		});

		expect(prisma.apiConnection.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				name: 'Custom',
				baseUrl: 'https://identity.example.com',
				authCredentialsEncrypted: TEST_ENCRYPTED_CREDENTIALS,
			}),
		});
	});

	it('API-FIX-02: createTestUser defaults passwordHashAlgorithm to shared default', async () => {
		const prisma = {
			user: {
				create: jest.fn().mockResolvedValue({ id: 'user-1' }),
			},
		};

		await createTestUser(prisma as unknown as PrismaClient, 'conn-1');

		expect(prisma.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				apiConnectionId: 'conn-1',
				passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
				passwordHash: TEST_PASSWORD_HASH,
			}),
		});
	});

	it('API-FIX-03: createTestUser merges overrides without dropping defaults', async () => {
		const prisma = {
			user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
		};
		await createTestUser(prisma as unknown as PrismaClient, 'conn-1', {
			username: 'jdoe',
			active: false,
		});
		expect(prisma.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				username: 'jdoe',
				active: false,
				passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
			}),
		});
	});

	it('API-FIX-04: createTestGroup passes apiConnectionId and generated externalId', async () => {
		const prisma = {
			group: { create: jest.fn().mockResolvedValue({ id: 'g1' }) },
		};
		await createTestGroup(prisma as unknown as PrismaClient, 'conn-99', { name: 'devs' });
		expect(prisma.group.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				apiConnectionId: 'conn-99',
				name: 'devs',
				externalId: expect.any(String),
			}),
		});
	});

	it('API-FIX-05: createTestRole passes apiConnectionId', async () => {
		const prisma = {
			role: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
		};
		await createTestRole(prisma as unknown as PrismaClient, 'conn-1');
		expect(prisma.role.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ apiConnectionId: 'conn-1' }),
		});
	});

	it('API-FIX-06: createTestSpConnection omits attributeMapping when not overridden', async () => {
		const prisma = {
			spConnection: { create: jest.fn().mockResolvedValue({ id: 'sp1' }) },
		};
		await createTestSpConnection(prisma as unknown as PrismaClient);
		const call = prisma.spConnection.create.mock.calls[0][0];
		expect(call.data.attributeMapping).toBeUndefined();
		expect(call.data.acsUrl).toBe('https://sp.example.com/acs');
	});

	it('API-FIX-07: createTestSpConnection applies attributeMapping override', async () => {
		const prisma = {
			spConnection: { create: jest.fn().mockResolvedValue({ id: 'sp1' }) },
		};
		const mapping = { email: 'mail' };
		await createTestSpConnection(prisma as unknown as PrismaClient, {
			attributeMapping: mapping,
		});
		expect(prisma.spConnection.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ attributeMapping: mapping }),
		});
	});

	it('API-FIX-08: createTestAdminUser uses dummy password hash never plaintext', async () => {
		const prisma = {
			adminUser: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
		};
		await createTestAdminUser(prisma as unknown as PrismaClient);
		expect(prisma.adminUser.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				passwordHash: TEST_PASSWORD_HASH,
			}),
		});
		const hash = prisma.adminUser.create.mock.calls[0][0].data.passwordHash;
		expect(hash).not.toContain('plaintext');
	});

	it('API-FIX-09: createTestSyncLog defaults status to RUNNING', async () => {
		const prisma = {
			syncLog: { create: jest.fn().mockResolvedValue({ id: 'log1' }) },
		};
		await createTestSyncLog(prisma as unknown as PrismaClient, 'conn-1');
		expect(prisma.syncLog.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				apiConnectionId: 'conn-1',
				status: 'RUNNING',
			}),
		});
	});

	it('API-FIX-10: createTestSamlSession sets future expiresAt by default', async () => {
		const prisma = {
			samlSession: { create: jest.fn().mockResolvedValue({ id: 's1' }) },
		};
		const before = Date.now();
		await createTestSamlSession(prisma as unknown as PrismaClient, 'sp-1');
		const expiresAt = prisma.samlSession.create.mock.calls[0][0].data.expiresAt as Date;
		expect(expiresAt.getTime()).toBeGreaterThan(before);
	});

	it('API-FIX-11: createTestIdpSettings uses singleton id default', async () => {
		const prisma = {
			idpSettings: { create: jest.fn().mockResolvedValue({ id: 'default' }) },
		};
		await createTestIdpSettings(prisma as unknown as PrismaClient);
		expect(prisma.idpSettings.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: 'default',
				entityId: 'https://idp.example.com',
			}),
		});
	});

	it('API-FIX-12: createTestAdminUserWithPassword stores bcrypt hash', async () => {
		const prisma = {
			adminUser: { create: jest.fn().mockResolvedValue({ id: 'admin-1' }) },
		};
		await createTestAdminUserWithPassword(
			prisma as unknown as PrismaClient,
			'fixture-admin',
			'known-password',
		);
		expect(prisma.adminUser.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				username: 'fixture-admin',
				passwordHash: expect.stringMatching(/^\$2/),
			}),
		});
	});

	it('API-FIX-13: createTestAdminUserWithPassword hash verifies with known plaintext', async () => {
		const { verifyPassword } = await import('@api/common/crypto/password.util');
		let capturedHash = '';
		const prisma = {
			adminUser: {
				create: jest.fn().mockImplementation(({ data }: { data: { passwordHash: string } }) => {
					capturedHash = data.passwordHash;
					return { id: 'admin-1', username: 'fixture-admin' };
				}),
			},
		};
		await createTestAdminUserWithPassword(
			prisma as unknown as PrismaClient,
			'fixture-admin',
			'super-secret-pass',
		);
		expect(await verifyPassword('super-secret-pass', capturedHash)).toBe(true);
		expect(await verifyPassword('wrong', capturedHash)).toBe(false);
	});

	it('API-FIX-15: createTestUserWithPassword hash verifies with known plaintext', async () => {
		const { verifyPassword } = await import('@api/common/crypto/password.util');
		let capturedHash = '';
		const prisma = {
			user: {
				create: jest.fn().mockImplementation(({ data }: { data: { passwordHash: string } }) => {
					capturedHash = data.passwordHash;
					return { id: 'user-1', username: 'fixture-user' };
				}),
			},
		};
		await createTestUserWithPassword(
			prisma as unknown as PrismaClient,
			'conn-1',
			'fixture-user',
			'synced-plain-pass',
		);
		expect(await verifyPassword('synced-plain-pass', capturedHash)).toBe(true);
		expect(await verifyPassword('wrong', capturedHash)).toBe(false);
	});

	it('API-FIX-14: bearerToken override encrypts with TEST_ENCRYPTION_KEY', async () => {
		const { decrypt } = await import('@api/encryption/utils/encryption.util');
		const { TEST_ENCRYPTION_KEY } = await import('@test/support/prisma/test-fixtures');

		let stored = '';
		const prisma = {
			apiConnection: {
				create: jest.fn().mockImplementation(({ data }) => {
					stored = data.authCredentialsEncrypted;
					return { id: 'conn-1', ...data };
				}),
			},
		};

		await createTestApiConnection(prisma as unknown as PrismaClient, {
			bearerToken: 'fixture-plain-token',
		});

		expect(stored.startsWith('v1:')).toBe(true);
		expect(decrypt(stored, TEST_ENCRYPTION_KEY)).toBe('fixture-plain-token');
	});

	it('API-FIX-16: createTestIdpSettingsWithSigningKey stores cert and encrypted key', async () => {
		const prisma = {
			idpSettings: {
				upsert: jest.fn().mockResolvedValue({
					id: 'default',
					signingCertPem: 'cert',
					signingKeyEncrypted: 'enc',
				}),
			},
		};
		await createTestIdpSettingsWithSigningKey(prisma as unknown as PrismaClient, {
			entityId: 'http://idp.test',
		});
		expect(prisma.idpSettings.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'default' },
				create: expect.objectContaining({
					signingCertPem: expect.stringContaining('BEGIN CERTIFICATE'),
					signingKeyEncrypted: expect.stringMatching(/^v1:/),
				}),
			}),
		);
	});

	it('API-FIX-17: buildTestAuthnRequestRedirectPayload returns encoded SAMLRequest', () => {
		const payload = buildTestAuthnRequestRedirectPayload({
			issuer: 'urn:fixture:sp',
		});
		expect(payload.samlRequest.length).toBeGreaterThan(10);
		expect(decodeURIComponent(payload.samlRequest)).toBeTruthy();
	});
});
