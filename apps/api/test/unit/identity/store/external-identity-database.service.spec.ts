import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { EncryptionService } from '@api/encryption/services/encryption.service';
import { IdentityRepository } from '@api/identity/identity.repository';
import { ActiveIdentityStore } from '@api/identity/store/active-identity-store';
import type {
	ExternalKysely,
	ExternalKyselyFactory,
} from '@api/identity/store/external/external-connection';
import { ExternalIdentityDatabaseService } from '@api/identity/store/external/external-identity-database.service';
import type { ExternalIdentityDB } from '@api/identity/store/external/external-schema-types';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(40_000);

// A shared-PGlite factory: every create() opens a Kysely over the SAME in-process Postgres, so the
// service's test/preview/connect/activate/resync calls all see one external database (like a real DB).
class SharedPgliteFactory implements ExternalKyselyFactory {
	readonly pglite = new PGlite();
	create(): ExternalKysely {
		const client = {
			query: async (sql: string, params: unknown[]) => {
				const r = await this.pglite.query(sql, params ?? []);
				return {
					rows: r.rows,
					rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length,
					command: '',
				};
			},
			release() {},
		};
		const pool = { connect: async () => client, end: async () => {} };
		const db = new Kysely<ExternalIdentityDB>({
			dialect: new PostgresDialect({ pool: pool as never }),
		});
		return { db, destroy: () => db.destroy() };
	}
	close() {
		return this.pglite.close();
	}
}

const connInput = {
	dialect: 'postgres' as const,
	host: 'localhost',
	port: 5432,
	database: 'ext',
	username: 'u',
	password: 'p',
	sslMode: 'disable' as const,
};

describe('ExternalIdentityDatabaseService (PGlite)', () => {
	let dbPath: string;
	let prisma: PrismaService;
	let repo: IdentityRepository;
	let active: ActiveIdentityStore;
	let factory: SharedPgliteFactory;
	let service: ExternalIdentityDatabaseService;
	let connId: string;
	let prevDatabaseUrl: string | undefined;

	beforeEach(async () => {
		dbPath = join(tmpdir(), `nestidp-extsvc-${randomUUID()}.db`);
		const url = `file:${dbPath}`;
		await runMigrationsOnTestDb(url);
		prevDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = url;
		prisma = new PrismaService({ url });
		repo = new IdentityRepository(prisma);
		active = new ActiveIdentityStore(repo);
		factory = new SharedPgliteFactory();
		const encryption = new EncryptionService({
			get: () => 'encryption-key-32-chars-min!!!',
		} as unknown as ConfigService);
		const audit = { recordSafe: jest.fn() };
		service = new ExternalIdentityDatabaseService(
			prisma,
			active,
			encryption,
			factory,
			audit as never,
			{ recordSuccess: jest.fn() } as never,
		);

		const conn = await createTestApiConnection(prisma);
		connId = conn.id;
		const u1 = await createTestUser(prisma, connId, { username: 'alice' });
		await createTestUser(prisma, connId, { username: 'bob' });
		const g = await createTestGroup(prisma, connId, { name: 'Eng' });
		const r = await createTestRole(prisma, connId, { name: 'admin' });
		await repo.replaceUserGroups(u1.id, [g.id]);
		await repo.replaceUserRoles(u1.id, [r.id]);
	});

	afterEach(async () => {
		await service.onModuleDestroy();
		await factory.close();
		await prisma.$disconnect();
		process.env.DATABASE_URL = prevDatabaseUrl;
		for (const f of readdirSync(dirname(dbPath))) {
			if (
				f.startsWith(`nestidp-extsvc-`) &&
				f.includes(dbPath.split('/').pop()!.replace('.db', ''))
			) {
				try {
					unlinkSync(join(dirname(dbPath), f));
				} catch {
					// ignore
				}
			}
		}
		for (const suffix of ['', '-wal', '-shm']) {
			if (existsSync(`${dbPath}${suffix}`)) rmSync(`${dbPath}${suffix}`, { force: true });
		}
	});

	it('EXT-SVC-PREVIEW-01: preview reports empty ownership + create counts (no writes)', async () => {
		const preview = await service.preview(connInput);
		expect(preview.reachable).toBe(true);
		expect(preview.ownership).toBe('empty');
		expect(preview.toCreate.users).toBe(2);
		expect(preview.willWipeLocal).toBe(true);
		// preview wrote nothing → local still authoritative with both users
		expect(active.mode()).toBe('local');
		expect(await repo.countUsers()).toBe(2);
	});

	it('EXT-SVC-RELOCATE-01: connect relocate + ack copies to external, backs up + wipes local, reads external', async () => {
		const res = await service.connect({
			...connInput,
			keepLocalCopy: false,
			acknowledgeBackup: true,
		});
		expect(res.localWiped).toBe(true);
		expect(res.backupPath).toBeTruthy();
		expect(existsSync(res.backupPath as string)).toBe(true);
		expect(active.mode()).toBe('external');
		// active store now reads the external DB
		expect(await active.countUsers()).toBe(2);
		// local identity was wiped
		expect(await repo.countUsers()).toBe(0);
		// SAML profile resolves from external (membership preserved)
		const alice = (await active.listUsers({ limit: 10, offset: 0 })).items.find(
			(u) => u.username === 'alice',
		);
		const profile = await active.findUserProfileById(alice!.id);
		expect(profile?.groups).toEqual(['Eng']);
		expect(profile?.roles).toEqual(['admin']);
	});

	it('EXT-SVC-WIPEACK-01: connect relocate WITHOUT ack copies but does not wipe local', async () => {
		const res = await service.connect({
			...connInput,
			keepLocalCopy: false,
			acknowledgeBackup: false,
		});
		expect(res.localWiped).toBe(false);
		expect(res.wipeSkipped).toBe(true);
		expect(await repo.countUsers()).toBe(2);
		expect(active.mode()).toBe('external');
	});

	it('EXT-SVC-MIRROR-01: connect mirror keeps local authoritative and copies to external', async () => {
		const res = await service.connect({ ...connInput, keepLocalCopy: true });
		expect(res.localWiped).toBe(false);
		expect(active.mode()).toBe('mirror');
		expect(await repo.countUsers()).toBe(2);
		// external copy exists
		const ext = new Kysely<ExternalIdentityDB>({
			dialect: new PostgresDialect({
				pool: {
					connect: async () => ({
						query: async (sql: string, params: unknown[]) => {
							const r = await factory.pglite.query(sql, params ?? []);
							return { rows: r.rows, rowCount: 0, command: '' };
						},
						release() {},
					}),
					end: async () => {},
				} as never,
			}),
		});
		const count = await ext
			.selectFrom('nestidp_user')
			.select((eb) => eb.fn.countAll().as('n'))
			.executeTakeFirst();
		expect(Number(count?.n)).toBe(2);
		await ext.destroy();
	});

	it('EXT-SVC-MIRROR-WT-01: a local write in mirror mode is pushed to the external copy', async () => {
		await service.connect({ ...connInput, keepLocalCopy: true });
		// a write through the active (mirroring) store
		await active.createManualUser({
			apiConnectionId: connId,
			username: 'mirrored',
			email: null,
			displayName: null,
			passwordHash: 'h',
			passwordHashAlgorithm: 'bcrypt',
			active: true,
			groupIds: [],
			roleIds: [],
		});
		await service.whenMirrorIdle();
		// local stays authoritative (3 users) and the external copy received the new user
		expect(await repo.countUsers()).toBe(3);
		const ext = new Kysely<ExternalIdentityDB>({
			dialect: new PostgresDialect({
				pool: {
					connect: async () => ({
						query: async (sql: string, params: unknown[]) => {
							const r = await factory.pglite.query(sql, params ?? []);
							return { rows: r.rows, rowCount: 0, command: '' };
						},
						release() {},
					}),
					end: async () => {},
				} as never,
			}),
		});
		const row = await ext
			.selectFrom('nestidp_user')
			.select('username')
			.where('username', '=', 'mirrored')
			.executeTakeFirst();
		await ext.destroy();
		expect(row?.username).toBe('mirrored');
		expect((await service.getStatus()).outOfSync).toBe(false);
	});

	it('EXT-SVC-DISCONNECT-01: disconnect (relocate) moves data back to local and reverts active', async () => {
		await service.connect({ ...connInput, keepLocalCopy: false, acknowledgeBackup: true });
		expect(await repo.countUsers()).toBe(0);
		await service.disconnect({ moveDataToLocal: true });
		expect(active.mode()).toBe('local');
		expect(await repo.countUsers()).toBe(2);
		const status = await service.getStatus();
		expect(status.configured).toBe(false);
	});

	it('EXT-SVC-LOCK-01: a concurrent operation is rejected while one is in progress', async () => {
		const p = service.connect({ ...connInput, keepLocalCopy: true });
		await expect(service.resync()).rejects.toThrow(/in progress/i);
		await p;
	});

	it('EXT-SVC-STATUS-01: not configured + no secret leakage in the status payload', async () => {
		const status = await service.getStatus();
		expect(status.configured).toBe(false);
		expect(status.mode).toBe('relocate');
		expect('password' in status).toBe(false);
		expect('passwordEncrypted' in status).toBe(false);
		// after connect, only hasPassword is exposed (never the secret)
		const secret = 'Sup3rSecretDbPassw0rd!';
		await service.connect({ ...connInput, password: secret, keepLocalCopy: true });
		const connected = await service.getStatus();
		expect(connected.hasPassword).toBe(true);
		expect(JSON.stringify(connected)).not.toContain(secret);
	});

	it('EXT-SVC-FOREIGN-01: connect aborts (and local untouched) when the target has foreign tables', async () => {
		await factory.pglite.query('CREATE TABLE nestidp_user (id text primary key)');
		await expect(
			service.connect({ ...connInput, keepLocalCopy: false, acknowledgeBackup: true }),
		).rejects.toThrow(/not ours/i);
		expect(active.mode()).toBe('local');
		expect(await repo.countUsers()).toBe(2);
		expect((await service.getStatus()).status).toBe('error');
	});

	it('EXT-SVC-TEST-01: testConnection returns a friendly error when the DB is unreachable', async () => {
		jest.spyOn(factory, 'create').mockReturnValueOnce({
			db: { selectNoFrom: () => ({ execute: () => Promise.reject(new Error('ECONNREFUSED')) }) },
			destroy: async () => undefined,
		} as never);
		const res = await service.testConnection(connInput);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/reach the database/i);
	});

	it('EXT-SVC-RESYNC-01: resync clears the out-of-sync flag (mirror)', async () => {
		await service.connect({ ...connInput, keepLocalCopy: true });
		await prisma.externalIdentityDatabase.update({
			where: { id: 'default' },
			data: { outOfSync: true },
		});
		const status = await service.resync();
		expect(status.outOfSync).toBe(false);
	});

	it('EXT-SVC-DISCONNECT-02: relocate detach without moving data requires acknowledgeDataLoss', async () => {
		await service.connect({ ...connInput, keepLocalCopy: false, acknowledgeBackup: true });
		await expect(service.disconnect({ moveDataToLocal: false })).rejects.toThrow(
			/acknowledgeDataLoss/i,
		);
		const status = await service.disconnect({ moveDataToLocal: false, acknowledgeDataLoss: true });
		expect(status.configured).toBe(false);
		expect(active.mode()).toBe('local');
		expect(await repo.countUsers()).toBe(0); // intentionally empty — data was not moved back
	});

	it('EXT-SVC-BOOT-01: a fresh service activates an already-attached external DB on module init', async () => {
		await service.connect({ ...connInput, keepLocalCopy: false, acknowledgeBackup: true });
		await service.onModuleDestroy();

		// simulate a restart: new holder + service over the SAME prisma + shared external DB
		const repo2 = new IdentityRepository(prisma);
		const active2 = new ActiveIdentityStore(repo2);
		const encryption2 = new EncryptionService({
			get: () => 'encryption-key-32-chars-min!!!',
		} as unknown as ConfigService);
		const service2 = new ExternalIdentityDatabaseService(
			prisma,
			active2,
			encryption2,
			factory,
			{ recordSafe: jest.fn() } as never,
			{ recordSuccess: jest.fn() } as never,
		);
		try {
			await service2.onModuleInit();
			expect(active2.mode()).toBe('external');
			expect(await active2.countUsers()).toBe(2);
		} finally {
			await service2.onModuleDestroy();
		}
	});

	it('EXT-SVC-BOOT-02: a failed boot activation stays local AND flags the config unreachable (§5.C)', async () => {
		await service.connect({ ...connInput, keepLocalCopy: false, acknowledgeBackup: true });
		await service.onModuleDestroy();

		// restart with a dead external DB: the factory cannot open a connection at all
		const repo2 = new IdentityRepository(prisma);
		const active2 = new ActiveIdentityStore(repo2);
		const encryption2 = new EncryptionService({
			get: () => 'encryption-key-32-chars-min!!!',
		} as unknown as ConfigService);
		const deadFactory = {
			create: () => {
				throw new Error('ECONNREFUSED');
			},
		};
		const service2 = new ExternalIdentityDatabaseService(
			prisma,
			active2,
			encryption2,
			deadFactory as never,
			{ recordSafe: jest.fn() } as never,
			{ recordSuccess: jest.fn() } as never,
		);
		try {
			await service2.onModuleInit(); // must not throw
			expect(active2.mode()).toBe('local');
			const row = await prisma.externalIdentityDatabase.findUnique({ where: { id: 'default' } });
			expect(row?.status).toBe('active'); // settings row untouched — runtime degraded
			expect(row?.reachable).toBe(false);
			expect(row?.lastProbeError).toContain('ECONNREFUSED');
		} finally {
			await service2.onModuleDestroy();
		}
	});
});
