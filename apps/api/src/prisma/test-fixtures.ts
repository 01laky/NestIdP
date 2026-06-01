import type {
	AdminUser,
	ApiConnection,
	Group,
	IdpSettings,
	Prisma,
	PrismaClient,
	Role,
	SamlSession,
	SpConnection,
	SyncLog,
	User,
} from '@prisma/client';
import { DEFAULT_PASSWORD_HASH_ALGORITHM } from '@nestidp/shared';
import { hashPassword } from '../admin-auth/password.util';
import { encrypt } from '../encryption/encryption.util';

export const TEST_ENCRYPTED_CREDENTIALS = 'test-encrypted-token';
export const TEST_ENCRYPTION_KEY = 'test-encryption-key-32chars!!';
export const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';

type ApiConnectionOverrides = Partial<Omit<ApiConnection, 'id' | 'createdAt' | 'updatedAt'>> & {
	bearerToken?: string;
};
type UserOverrides = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>;
type GroupOverrides = Partial<Omit<Group, 'id' | 'createdAt' | 'updatedAt'>>;
type RoleOverrides = Partial<Omit<Role, 'id' | 'createdAt' | 'updatedAt'>>;
type SpConnectionOverrides = Partial<
	Omit<SpConnection, 'id' | 'createdAt' | 'updatedAt' | 'attributeMapping'> & {
		attributeMapping?: Prisma.InputJsonValue;
	}
>;
type AdminUserOverrides = Partial<Omit<AdminUser, 'id' | 'createdAt' | 'updatedAt'>>;
type SyncLogOverrides = Partial<
	Omit<SyncLog, 'id' | 'startedAt' | 'errors'> & {
		errors?: Prisma.InputJsonValue;
	}
>;
type SamlSessionOverrides = Partial<Omit<SamlSession, 'id' | 'createdAt'>>;
type IdpSettingsOverrides = Partial<Omit<IdpSettings, 'createdAt' | 'updatedAt'>>;

export async function createTestApiConnection(
	prisma: PrismaClient,
	overrides: ApiConnectionOverrides = {},
): Promise<ApiConnection> {
	const { bearerToken, ...rest } = overrides;
	const authCredentialsEncrypted =
		rest.authCredentialsEncrypted ??
		(bearerToken !== undefined
			? encrypt(bearerToken, TEST_ENCRYPTION_KEY)
			: TEST_ENCRYPTED_CREDENTIALS);

	return prisma.apiConnection.create({
		data: {
			name: 'Test API',
			baseUrl: 'https://identity.example.com',
			authCredentialsEncrypted,
			...rest,
		},
	});
}

export async function createTestUser(
	prisma: PrismaClient,
	apiConnectionId: string,
	overrides: UserOverrides = {},
): Promise<User> {
	return prisma.user.create({
		data: {
			externalId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			apiConnectionId,
			username: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			passwordHash: TEST_PASSWORD_HASH,
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
			...overrides,
		},
	});
}

export async function createTestGroup(
	prisma: PrismaClient,
	apiConnectionId: string,
	overrides: GroupOverrides = {},
): Promise<Group> {
	return prisma.group.create({
		data: {
			externalId: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			apiConnectionId,
			name: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			...overrides,
		},
	});
}

export async function createTestRole(
	prisma: PrismaClient,
	apiConnectionId: string,
	overrides: RoleOverrides = {},
): Promise<Role> {
	return prisma.role.create({
		data: {
			externalId: `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			apiConnectionId,
			name: `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			...overrides,
		},
	});
}

export async function createTestSpConnection(
	prisma: PrismaClient,
	overrides: SpConnectionOverrides = {},
): Promise<SpConnection> {
	const { attributeMapping, ...rest } = overrides;
	return prisma.spConnection.create({
		data: {
			name: 'Test SP',
			spEntityId: `urn:sp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			acsUrl: 'https://sp.example.com/acs',
			...(attributeMapping !== undefined ? { attributeMapping } : {}),
			...rest,
		},
	});
}

export async function createTestAdminUser(
	prisma: PrismaClient,
	overrides: AdminUserOverrides = {},
): Promise<AdminUser> {
	return prisma.adminUser.create({
		data: {
			username: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			passwordHash: TEST_PASSWORD_HASH,
			...overrides,
		},
	});
}

export async function createTestUserWithPassword(
	prisma: PrismaClient,
	apiConnectionId: string,
	username: string,
	plaintextPassword: string,
	overrides: UserOverrides = {},
): Promise<User> {
	const passwordHash = await hashPassword(plaintextPassword);
	const { externalId, ...rest } = overrides;
	return prisma.user.create({
		data: {
			externalId: externalId ?? `ext-${username}`,
			apiConnectionId,
			username,
			passwordHash,
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
			active: true,
			...rest,
		},
	});
}

export async function createTestAdminUserWithPassword(
	prisma: PrismaClient,
	username: string,
	plaintextPassword: string,
	overrides: AdminUserOverrides = {},
): Promise<AdminUser> {
	const passwordHash = await hashPassword(plaintextPassword);
	return prisma.adminUser.create({
		data: {
			username,
			passwordHash,
			...overrides,
		},
	});
}

export async function createTestSyncLog(
	prisma: PrismaClient,
	apiConnectionId: string,
	overrides: SyncLogOverrides = {},
): Promise<SyncLog> {
	return prisma.syncLog.create({
		data: {
			apiConnectionId,
			status: 'RUNNING',
			...overrides,
		},
	});
}

export async function createTestSamlSession(
	prisma: PrismaClient,
	spConnectionId: string,
	overrides: SamlSessionOverrides = {},
): Promise<SamlSession> {
	return prisma.samlSession.create({
		data: {
			samlRequestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			spConnectionId,
			expiresAt: new Date(Date.now() + 5 * 60 * 1000),
			...overrides,
		},
	});
}

export async function createTestIdpSettings(
	prisma: PrismaClient,
	overrides: IdpSettingsOverrides = {},
): Promise<IdpSettings> {
	return prisma.idpSettings.create({
		data: {
			id: 'default',
			entityId: 'https://idp.example.com',
			...overrides,
		},
	});
}

export type { Prisma };
