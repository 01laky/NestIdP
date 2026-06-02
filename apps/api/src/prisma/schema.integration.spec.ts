import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
	createTestAdminUser,
	createTestApiConnection,
	createTestGroup,
	createTestIdpSettings,
	createTestRole,
	createTestSamlSession,
	createTestSpConnection,
	createTestSyncLog,
	createTestUser,
	getTestSigningMaterial,
} from './test-fixtures';
import { runMigrationsOnTestDb } from './test-db.helper';

jest.setTimeout(30_000);

describe('schema integration (SQLite)', () => {
	let databaseUrl: string;
	let prisma: PrismaClient;

	beforeAll(() => {
		const tmpDb = join(tmpdir(), `nestidp-test-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');
		prisma = new PrismaClient({
			datasources: { db: { url: databaseUrl } },
		});
	});

	afterAll(async () => {
		await prisma.$disconnect();
		const filePath = databaseUrl.replace(/^file:/, '');
		try {
			unlinkSync(filePath);
		} catch {
			// ignore cleanup errors
		}
	});

	it('API-SCH-01: migration deploy succeeds and models are usable', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const group = await createTestGroup(prisma, connection.id);
		const role = await createTestRole(prisma, connection.id);
		const sp = await createTestSpConnection(prisma);
		const admin = await createTestAdminUser(prisma);
		const syncLog = await createTestSyncLog(prisma, connection.id);
		const session = await createTestSamlSession(prisma, sp.id);
		const settings = await createTestIdpSettings(prisma);

		expect(connection.id).toBeDefined();
		expect(user.id).toBeDefined();
		expect(group.id).toBeDefined();
		expect(role.id).toBeDefined();
		expect(sp.id).toBeDefined();
		expect(admin.id).toBeDefined();
		expect(syncLog.id).toBeDefined();
		expect(session.id).toBeDefined();
		expect(settings.id).toBe('default');
	});

	it('API-SCH-02: creates ApiConnection and User with relation', async () => {
		const connection = await createTestApiConnection(prisma, { name: 'Rel Test' });
		const user = await createTestUser(prisma, connection.id, {
			externalId: 'ext-rel-001',
			username: `rel-user-${randomUUID()}`,
		});

		const loaded = await prisma.user.findUnique({
			where: { id: user.id },
			include: { apiConnection: true },
		});

		expect(loaded?.apiConnection.id).toBe(connection.id);
	});

	it('API-SCH-03: duplicate username violates unique constraint', async () => {
		const connection = await createTestApiConnection(prisma);
		const username = `dup-user-${randomUUID()}`;
		await createTestUser(prisma, connection.id, { username });

		await expect(
			createTestUser(prisma, connection.id, {
				username,
				externalId: 'other-ext',
			}),
		).rejects.toThrow();
	});

	it('API-SCH-04: duplicate apiConnectionId + externalId violates unique constraint', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestUser(prisma, connection.id, {
			externalId: 'ext-dup',
			username: `user-a-${randomUUID()}`,
		});

		await expect(
			createTestUser(prisma, connection.id, {
				externalId: 'ext-dup',
				username: `user-b-${randomUUID()}`,
			}),
		).rejects.toThrow();
	});

	it('API-SCH-05: duplicate group name within same connection violates unique constraint', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestGroup(prisma, connection.id, {
			externalId: 'grp-1',
			name: 'developers',
		});

		await expect(
			createTestGroup(prisma, connection.id, {
				externalId: 'grp-2',
				name: 'developers',
			}),
		).rejects.toThrow();
	});

	it('API-SCH-06: same externalId on different apiConnectionId is allowed', async () => {
		const connA = await createTestApiConnection(prisma, { name: 'Source A' });
		const connB = await createTestApiConnection(prisma, { name: 'Source B' });

		await createTestUser(prisma, connA.id, {
			externalId: 'shared-ext',
			username: `user-a-${randomUUID()}`,
		});
		await expect(
			createTestUser(prisma, connB.id, {
				externalId: 'shared-ext',
				username: `user-b-${randomUUID()}`,
			}),
		).resolves.toBeDefined();
	});

	it('API-SCH-07: UserGroup rows cascade when User is deleted', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const group = await createTestGroup(prisma, connection.id);

		await prisma.userGroup.create({
			data: { userId: user.id, groupId: group.id },
		});

		await prisma.user.delete({ where: { id: user.id } });

		const joinCount = await prisma.userGroup.count({
			where: { userId: user.id },
		});
		expect(joinCount).toBe(0);
	});

	it('API-SCH-08: UserRole rows cascade when Role is deleted', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const role = await createTestRole(prisma, connection.id);

		await prisma.userRole.create({
			data: { userId: user.id, roleId: role.id },
		});

		await prisma.role.delete({ where: { id: role.id } });

		const joinCount = await prisma.userRole.count({
			where: { roleId: role.id },
		});
		expect(joinCount).toBe(0);
	});

	it('API-SCH-09: SamlSession requires valid spConnectionId', async () => {
		await expect(
			prisma.samlSession.create({
				data: {
					samlRequestId: `bad-${randomUUID()}`,
					spConnectionId: 'missing-sp',
					expiresAt: new Date(Date.now() + 60_000),
				},
			}),
		).rejects.toThrow();
	});

	it('API-SCH-10: SamlSession userId is nullable and can be linked after create', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const sp = await createTestSpConnection(prisma);

		const session = await createTestSamlSession(prisma, sp.id, { userId: null });
		expect(session.userId).toBeNull();

		const linked = await prisma.samlSession.update({
			where: { id: session.id },
			data: { userId: user.id },
		});
		expect(linked.userId).toBe(user.id);
	});

	it('API-SCH-11: IdpSettings singleton id default cannot be duplicated', async () => {
		await prisma.idpSettings.deleteMany();
		await createTestIdpSettings(prisma, { entityId: 'https://idp-a.example.com' });

		await expect(
			createTestIdpSettings(prisma, { entityId: 'https://idp-b.example.com' }),
		).rejects.toThrow();
	});

	it('API-SCH-12: AdminUser username unique constraint', async () => {
		const username = `admin-dup-${randomUUID()}`;
		await createTestAdminUser(prisma, { username });

		await expect(createTestAdminUser(prisma, { username })).rejects.toThrow();
	});

	it('API-SCH-13: SpConnection spEntityId unique constraint', async () => {
		const spEntityId = `urn:sp:dup:${randomUUID()}`;
		await createTestSpConnection(prisma, { spEntityId });

		await expect(createTestSpConnection(prisma, { spEntityId })).rejects.toThrow();
	});

	it('API-SCH-14: SyncLog stores errors as JSON array', async () => {
		const connection = await createTestApiConnection(prisma);
		const errors = [{ code: 'FETCH_FAILED', message: 'timeout' }];

		const log = await createTestSyncLog(prisma, connection.id, {
			status: 'FAILED',
			errors,
		});

		const loaded = await prisma.syncLog.findUnique({ where: { id: log.id } });
		expect(loaded?.errors).toEqual(errors);
	});

	it('API-SCH-15: deleting ApiConnection with User rows is restricted', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestUser(prisma, connection.id);

		await expect(prisma.apiConnection.delete({ where: { id: connection.id } })).rejects.toThrow();
	});

	it('API-SCH-16: deleting User cascades UserGroup join rows', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const group = await createTestGroup(prisma, connection.id);

		await prisma.userGroup.create({
			data: { userId: user.id, groupId: group.id },
		});

		await prisma.user.delete({ where: { id: user.id } });

		expect(
			await prisma.userGroup.count({
				where: { userId: user.id, groupId: group.id },
			}),
		).toBe(0);
	});

	it('API-SCH-17: duplicate role name within same connection violates unique constraint', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestRole(prisma, connection.id, { externalId: 'r1', name: 'editor' });
		await expect(
			createTestRole(prisma, connection.id, { externalId: 'r2', name: 'editor' }),
		).rejects.toThrow();
	});

	it('API-SCH-18: same group name on different connections is allowed', async () => {
		const connA = await createTestApiConnection(prisma, { name: 'A' });
		const connB = await createTestApiConnection(prisma, { name: 'B' });
		await createTestGroup(prisma, connA.id, { externalId: 'g1', name: 'developers' });
		await expect(
			createTestGroup(prisma, connB.id, { externalId: 'g2', name: 'developers' }),
		).resolves.toBeDefined();
	});

	it('API-SCH-19: duplicate samlRequestId violates unique constraint', async () => {
		const sp = await createTestSpConnection(prisma);
		const requestId = `req-dup-${randomUUID()}`;
		await createTestSamlSession(prisma, sp.id, { samlRequestId: requestId });
		await expect(
			createTestSamlSession(prisma, sp.id, { samlRequestId: requestId }),
		).rejects.toThrow();
	});

	it('API-SCH-20: deleting SpConnection cascades SamlSession rows', async () => {
		const sp = await createTestSpConnection(prisma);
		const session = await createTestSamlSession(prisma, sp.id);
		await prisma.spConnection.delete({ where: { id: sp.id } });
		expect(await prisma.samlSession.count({ where: { id: session.id } })).toBe(0);
	});

	it('API-SCH-21: deleting User sets SamlSession.userId to null (SetNull)', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const sp = await createTestSpConnection(prisma);
		const session = await createTestSamlSession(prisma, sp.id, { userId: user.id });
		await prisma.user.delete({ where: { id: user.id } });
		const reloaded = await prisma.samlSession.findUnique({ where: { id: session.id } });
		expect(reloaded?.userId).toBeNull();
	});

	it('API-SCH-22: deleting ApiConnection with SyncLog rows is restricted', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestSyncLog(prisma, connection.id);
		await expect(prisma.apiConnection.delete({ where: { id: connection.id } })).rejects.toThrow();
	});

	it('API-SCH-23: deleting ApiConnection with no children succeeds', async () => {
		const connection = await createTestApiConnection(prisma);
		await expect(
			prisma.apiConnection.delete({ where: { id: connection.id } }),
		).resolves.toBeDefined();
	});

	it('API-SCH-24: duplicate UserGroup composite key is rejected', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const group = await createTestGroup(prisma, connection.id);
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
		await expect(
			prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } }),
		).rejects.toThrow();
	});

	it('API-SCH-25: duplicate UserRole composite key is rejected', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const role = await createTestRole(prisma, connection.id);
		await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
		await expect(
			prisma.userRole.create({ data: { userId: user.id, roleId: role.id } }),
		).rejects.toThrow();
	});

	it('API-SCH-26: User.active=false persists and readable', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id, { active: false });
		const loaded = await prisma.user.findUnique({ where: { id: user.id } });
		expect(loaded?.active).toBe(false);
	});

	it('API-SCH-27: ApiConnection defaults authType BEARER and lastSyncStatus NEVER', async () => {
		const connection = await createTestApiConnection(prisma);
		const loaded = await prisma.apiConnection.findUnique({ where: { id: connection.id } });
		expect(loaded?.authType).toBe('BEARER');
		expect(loaded?.lastSyncStatus).toBe('NEVER');
		expect(loaded?.lastSyncAt).toBeNull();
	});

	it('API-SCH-28: duplicate group externalId within same connection is rejected', async () => {
		const connection = await createTestApiConnection(prisma);
		await createTestGroup(prisma, connection.id, { externalId: 'grp-ext', name: 'a' });
		await expect(
			createTestGroup(prisma, connection.id, { externalId: 'grp-ext', name: 'b' }),
		).rejects.toThrow();
	});

	it('API-SCH-29: SyncLog counters default to zero', async () => {
		const connection = await createTestApiConnection(prisma);
		const log = await createTestSyncLog(prisma, connection.id);
		expect(log.usersSynced).toBe(0);
		expect(log.groupsSynced).toBe(0);
		expect(log.rolesSynced).toBe(0);
	});

	it('API-SCH-30: SpConnection allows null attributeMapping', async () => {
		const sp = await createTestSpConnection(prisma);
		const loaded = await prisma.spConnection.findUnique({ where: { id: sp.id } });
		expect(loaded?.attributeMapping).toBeNull();
	});

	it('API-SCH-31: IdpSettings requires entityId on create', async () => {
		await prisma.idpSettings.deleteMany();
		await expect(
			prisma.idpSettings.create({
				data: { id: 'default' } as { id: string; entityId: string },
			}),
		).rejects.toThrow();
	});

	it('API-SCH-32: deleting Group cascades UserGroup but leaves User', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const group = await createTestGroup(prisma, connection.id);
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
		await prisma.group.delete({ where: { id: group.id } });
		expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
		expect(await prisma.userGroup.count({ where: { userId: user.id } })).toBe(0);
	});

	it('API-SCH-33: User optional email and displayName persist null', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id, {
			email: null,
			displayName: null,
		});
		const loaded = await prisma.user.findUnique({ where: { id: user.id } });
		expect(loaded?.email).toBeNull();
		expect(loaded?.displayName).toBeNull();
	});

	it('API-SCH-34: SpConnection spCertificate optional null', async () => {
		const sp = await createTestSpConnection(prisma, { spCertificate: null });
		const loaded = await prisma.spConnection.findUnique({ where: { id: sp.id } });
		expect(loaded?.spCertificate).toBeNull();
	});

	it('API-SCH-35: SyncLog finishedAt nullable until run completes', async () => {
		const connection = await createTestApiConnection(prisma);
		const log = await createTestSyncLog(prisma, connection.id, { status: 'RUNNING' });
		expect(log.finishedAt).toBeNull();
		const finished = await prisma.syncLog.update({
			where: { id: log.id },
			data: { status: 'SUCCESS', finishedAt: new Date() },
		});
		expect(finished.finishedAt).not.toBeNull();
	});

	it('API-IDP-SCH-01: IdpSettings rotation columns exist after migration', async () => {
		const settings = await createTestIdpSettings(prisma, {
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			rotationStartedAt: null,
		});
		expect(settings.pendingSigningCertPem).toBeNull();
		expect(settings.pendingSigningKeyEncrypted).toBeNull();
		expect(settings.rotationStartedAt).toBeNull();
	});

	it('API-IDP-SCH-02: existing IdpSettings rows backfill nullable pending columns', async () => {
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.pendingSigningCertPem ?? null).toBeNull();
		expect(settings?.pendingSigningKeyEncrypted ?? null).toBeNull();
	});

	it('API-IDP-SCH-03: pending rotation columns persist round-trip', async () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial(
			'https://pending-roundtrip.example.com',
		);
		const { encrypt } = await import('../encryption/encryption.util');
		const started = new Date('2026-03-01T10:00:00.000Z');
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: certPem,
				pendingSigningKeyEncrypted: encrypt(privateKeyPem, 'test-encryption-key-32chars!!'),
				rotationStartedAt: started,
			},
		});
		const loaded = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(loaded?.pendingSigningCertPem).toBe(certPem);
		expect(loaded?.pendingSigningKeyEncrypted).toContain('v1:');
		expect(loaded?.rotationStartedAt?.toISOString()).toBe(started.toISOString());
	});
});
