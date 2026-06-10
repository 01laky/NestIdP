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
import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '@api/common/crypto/password.util';
import { encrypt } from '@api/encryption/utils/encryption.util';
import { generateTestRsaEncryptionCert } from '@test/support/crypto/test-cert.util';
import { buildTestAuthnRequestRedirectPayload as buildAuthnRedirectPayload } from '@test/support/saml/build-authn-request.util';

export const TEST_ENCRYPTED_CREDENTIALS = 'test-encrypted-token';
export const TEST_ENCRYPTION_KEY = 'test-encryption-key-32chars!!';
export const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';

/** Default (off) scheduled-sync columns (Prompt 32) for full `ApiConnection` literals in unit tests. */
export const SCHEDULE_FIELD_DEFAULTS = {
	scheduleEnabled: false,
	scheduleCron: null,
	scheduleTimezone: null,
	schedulePaused: false,
	scheduleDryRun: false,
	nextRunAt: null,
	lastScheduledRunAt: null,
	lastScheduledRunStatus: null,
	scheduleLastError: null,
	scheduleConsecutiveFailures: 0,
	scheduleAutoPausedAt: null,
} satisfies Partial<ApiConnection>;

/** Default values for the Prompt 37 multi-source columns — spread into full `ApiConnection` literals. */
export const MULTI_SOURCE_FIELD_DEFAULTS = {
	includeInSyncAll: true,
	usernameCollisionPolicy: null,
	lastCollisionCount: 0,
} satisfies Partial<ApiConnection>;

/** Default (proxy-off) values for the Prompt 33 proxy columns — spread into ApiConnection literals. */
export const PROXY_FIELD_DEFAULTS = {
	proxyEnabled: false,
	proxyUrl: null,
	proxyUsername: null,
	proxyPasswordEncrypted: null,
	noProxyHosts: null,
	lastProxyCheckStatus: null,
	lastProxyCheckAt: null,
} satisfies Partial<ApiConnection>;

type ApiConnectionOverrides = Partial<
	Omit<
		ApiConnection,
		'id' | 'createdAt' | 'updatedAt' | 'apiContractConfig' | 'oauthTokenRequestParams'
	> & {
		apiContractConfig?: Prisma.InputJsonValue;
		oauthTokenRequestParams?: Prisma.InputJsonValue;
	}
> & {
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
type SpConnectionWithSigningKeyOverrides = Omit<SpConnectionOverrides, 'spCertificate'>;
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

export async function createTestSpConnectionWithSigningKey(
	prisma: PrismaClient,
	overrides: SpConnectionWithSigningKeyOverrides = {},
): Promise<{
	spConnection: SpConnection;
	spPrivateKeyPem: string;
	spCertificatePem: string;
}> {
	const entityId =
		overrides.spEntityId ?? `urn:sp:signed:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const { privateKeyPem, certPem } = generateTestRsaCert(entityId);
	const spConnection = await createTestSpConnection(prisma, {
		...overrides,
		spEntityId: entityId,
		spCertificate: certPem,
	});
	return {
		spConnection,
		spPrivateKeyPem: privateKeyPem,
		spCertificatePem: certPem,
	};
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

export async function createTestIdpSettingsWithEcEncryptionKey(
	prisma: PrismaClient,
	curve: 'P-256' | 'P-384' | 'P-521' = 'P-256',
	overrides: IdpSettingsOverrides = {},
): Promise<{ settings: IdpSettings; privateKeyPem: string; certPem: string }> {
	const entityId = overrides.entityId ?? 'http://localhost:3000';
	const { privateKeyPem, certPem } = generateTestEcCert(entityId, curve);
	const settings = await prisma.idpSettings.upsert({
		where: { id: 'default' },
		create: {
			id: 'default',
			entityId,
			encryptionCertPem: certPem,
			encryptionKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionKeyFamily: 'ec',
			encryptionEcCurve: curve,
			...overrides,
		},
		update: {
			entityId,
			encryptionCertPem: certPem,
			encryptionKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionKeyFamily: 'ec',
			encryptionEcCurve: curve,
			...overrides,
		},
	});
	return { settings, privateKeyPem, certPem };
}

export async function createTestIdpSettingsWithEncryptionKey(
	prisma: PrismaClient,
	overrides: IdpSettingsOverrides = {},
): Promise<IdpSettings> {
	const entityId = overrides.entityId ?? 'http://localhost:3000';
	const { privateKeyPem, certPem } = generateTestRsaEncryptionCert(entityId);
	return prisma.idpSettings.upsert({
		where: { id: 'default' },
		create: {
			id: 'default',
			entityId,
			encryptionCertPem: certPem,
			encryptionKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionKeyFamily: 'rsa',
			encryptionRsaModulusBits: 2048,
			...overrides,
		},
		update: {
			entityId,
			encryptionCertPem: certPem,
			encryptionKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			encryptionKeyFamily: 'rsa',
			encryptionRsaModulusBits: 2048,
			...overrides,
		},
	});
}

export async function createTestIdpSettingsWithSigningKey(
	prisma: PrismaClient,
	overrides: IdpSettingsOverrides = {},
): Promise<IdpSettings> {
	const entityId = overrides.entityId ?? 'http://localhost:3000';
	const { privateKeyPem, certPem } = generateTestRsaCert(entityId);
	return prisma.idpSettings.upsert({
		where: { id: 'default' },
		create: {
			id: 'default',
			entityId,
			signingCertPem: certPem,
			signingKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			...overrides,
		},
		update: {
			entityId,
			signingCertPem: certPem,
			signingKeyEncrypted: encrypt(privateKeyPem, TEST_ENCRYPTION_KEY),
			...overrides,
		},
	});
}

export function buildTestAuthnRequestRedirectPayload(options: {
	id?: string;
	issuer: string;
	destination?: string;
	relayState?: string;
}): { samlRequest: string; relayState?: string } {
	return buildAuthnRedirectPayload({
		...options,
		destination: options.destination ?? 'http://localhost:3000/saml/sso',
	});
}

export function getTestSigningMaterial(entityId = 'http://localhost:3000'): {
	privateKeyPem: string;
	certPem: string;
} {
	return generateTestRsaCert(entityId);
}

/** RSA key pair for SP assertion encryption round-trip tests. */
export function getTestSpEncryptionKeyPair(entityId = 'urn:test:sp:encryption'): {
	privateKeyPem: string;
	certPem: string;
} {
	return generateTestRsaCert(entityId);
}

export function getTestSigningMaterialWithDays(
	entityId: string,
	days: number,
): { privateKeyPem: string; certPem: string } {
	return generateTestRsaCert(entityId, days);
}

export async function createTestSpConnectionWithEcSigningKey(
	prisma: PrismaClient,
	overrides: SpConnectionWithSigningKeyOverrides = {},
): Promise<{
	spConnection: SpConnection;
	spPrivateKeyPem: string;
	spCertificatePem: string;
}> {
	const entityId =
		overrides.spEntityId ?? `urn:sp:ec:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const { privateKeyPem, certPem } = generateTestEcCert(entityId, 'P-256');
	const spConnection = await createTestSpConnection(prisma, {
		...overrides,
		spEntityId: entityId,
		spCertificate: certPem,
	});
	return {
		spConnection,
		spPrivateKeyPem: privateKeyPem,
		spCertificatePem: certPem,
	};
}

function generateTestEcCert(
	entityId: string,
	curve: 'P-256' | 'P-384' | 'P-521' = 'P-256',
): { privateKeyPem: string; certPem: string } {
	const { privateKey } = generateKeyPairSync('ec', {
		namedCurve: curve,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-test-ec-cert-'));
	try {
		const keyPath = join(tmp, 'key.pem');
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(keyPath, privateKey);
		const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
		execSync(
			`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=${cn}" -nodes`,
			{ stdio: 'pipe' },
		);
		return { privateKeyPem: privateKey, certPem: readFileSync(certPath, 'utf8') };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

export { generateTestEcCert };

function generateTestRsaCert(
	entityId: string,
	days = 365,
): { privateKeyPem: string; certPem: string } {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-test-cert-'));
	try {
		const keyPath = join(tmp, 'key.pem');
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(keyPath, privateKey);
		const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
		execSync(
			`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days ${days} -subj "/CN=${cn}" -nodes`,
			{ stdio: 'pipe' },
		);
		return { privateKeyPem: privateKey, certPem: readFileSync(certPath, 'utf8') };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

export type { Prisma };
