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
});
