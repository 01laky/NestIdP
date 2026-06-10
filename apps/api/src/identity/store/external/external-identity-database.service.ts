import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import type { ExternalIdentityDatabase } from '@prisma/client';
import type {
	ConnectExternalDbRequest,
	ConnectExternalDbResponseDto,
	DisconnectExternalDbRequest,
	ExternalDbConnectionInput,
	ExternalDbPreviewResponseDto,
	ExternalDbStatusResponseDto,
	TestExternalDbResponseDto,
} from '@nestidp/shared';
import { AuditPersistenceService } from '../../../audit/services/audit-persistence.service';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../../encryption/credentials-encryption.port';
import { createLibsqlClient, requireDatabaseUrl } from '../../../prisma/libsql';
import { PrismaService } from '../../../prisma/services/prisma.service';
import { ActiveIdentityStore } from '../active-identity-store';
import type { IdentitySnapshot } from '../identity-store';
import {
	type ExternalDbConfig,
	type ExternalKysely,
	EXTERNAL_KYSELY_FACTORY,
	type ExternalKyselyFactory,
} from './external-connection';
import { classifyOwnership, ensureSchema } from './external-schema';
import { createMirroringStore } from './mirroring-identity-store';
import { CircuitBreaker, withResilience } from './resilience';
import { SqlIdentityStore } from './sql-identity-store';
import { AccountLockoutService } from '../../../auth-protection/account-lockout.service';

const CONFIG_ID = 'default';

@Injectable()
export class ExternalIdentityDatabaseService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger('ExternalIdentityDatabase');
	private active: ExternalKysely | null = null;
	private activeDialect: 'postgres' | 'mysql' | null = null;
	private breaker: CircuitBreaker | null = null;
	private probe: NodeJS.Timeout | null = null;
	private busy = false;
	private mirrorQueued = false;
	private mirrorRunning: Promise<void> | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly store: ActiveIdentityStore,
		@Inject(CREDENTIALS_ENCRYPTION) private readonly encryption: CredentialsEncryptionPort,
		@Inject(EXTERNAL_KYSELY_FACTORY) private readonly factory: ExternalKyselyFactory,
		private readonly audit: AuditPersistenceService,
		private readonly accountLockout: AccountLockoutService,
	) {}

	async onModuleInit(): Promise<void> {
		const cfg = await this.loadConfig();
		if (cfg?.status === 'active') {
			try {
				await this.activate(cfg);
				this.logger.log(`External identity database active (${cfg.dialect}, mode=${cfg.mode}).`);
			} catch (error) {
				this.logger.error(
					`External identity database configured but could not be activated at boot: ${this.msg(error)}. ` +
						'Identity is degraded until it is reachable or detached.',
				);
				// Best-effort status update so the admin UI shows the degraded state (the settings row
				// still says active/external while the runtime fell back to local). Must never throw.
				await this.markReachable(false, this.msg(error)).catch(() => undefined);
			}
		}
	}

	async onModuleDestroy(): Promise<void> {
		this.stopProbe();
		await this.active?.destroy().catch(() => undefined);
	}

	// --- public API ---

	async getStatus(): Promise<ExternalDbStatusResponseDto> {
		const cfg = await this.loadConfig();
		if (!cfg) {
			return {
				configured: false,
				status: 'disconnected',
				mode: 'relocate',
				keepLocalCopy: false,
				hasPassword: false,
				reachable: false,
				outOfSync: false,
				schemaVersion: 0,
			};
		}
		const counts = cfg.status === 'active' ? await this.safeCounts() : undefined;
		return {
			configured: true,
			status: cfg.status as ExternalDbStatusResponseDto['status'],
			mode: cfg.mode as ExternalDbStatusResponseDto['mode'],
			dialect: cfg.dialect as ExternalDbStatusResponseDto['dialect'],
			host: cfg.host,
			port: cfg.port,
			database: cfg.database,
			username: cfg.username,
			sslMode: cfg.sslMode as ExternalDbStatusResponseDto['sslMode'],
			keepLocalCopy: cfg.keepLocalCopy,
			hasPassword: cfg.passwordEncrypted.length > 0,
			reachable: cfg.reachable,
			breaker: this.breaker?.state,
			outOfSync: cfg.outOfSync,
			schemaVersion: cfg.schemaVersion,
			counts,
			migration: { phase: cfg.migrationPhase, done: cfg.migrationDone, total: cfg.migrationTotal },
			lastError: cfg.lastError,
			lastSyncAt: cfg.lastSyncAt?.toISOString() ?? null,
			connectedAt: cfg.connectedAt?.toISOString() ?? null,
		};
	}

	async testConnection(input: ExternalDbConnectionInput): Promise<TestExternalDbResponseDto> {
		const password = await this.resolvePassword(input.password);
		const conn = this.factory.create(this.toDbConfig(input, password));
		try {
			await conn.db.selectNoFrom((eb) => eb.lit(1).as('one')).execute();
			return { ok: true, dialect: input.dialect };
		} catch (error) {
			return { ok: false, dialect: input.dialect, error: this.friendly(error) };
		} finally {
			await conn.destroy().catch(() => undefined);
		}
	}

	async preview(input: ExternalDbConnectionInput): Promise<ExternalDbPreviewResponseDto> {
		const password = await this.resolvePassword(input.password);
		const conn = this.factory.create(this.toDbConfig(input, password));
		try {
			const ownership = await classifyOwnership(conn.db);
			const local = await this.store.getLocal().exportAll();
			const willWipeLocal = !(input as ConnectExternalDbRequest).keepLocalCopy;
			if (ownership === 'foreign') {
				return {
					reachable: true,
					ownership,
					schemaPresent: true,
					willWipeLocal,
					toCreate: { users: 0, groups: 0, roles: 0 },
					toUpdate: { users: 0, groups: 0, roles: 0 },
					conflicts: [],
					error:
						'The target database already contains tables under the nestidp_ prefix that are not ours.',
				};
			}
			if (ownership === 'empty') {
				return {
					reachable: true,
					ownership,
					schemaPresent: false,
					willWipeLocal,
					toCreate: {
						users: local.users.length,
						groups: local.groups.length,
						roles: local.roles.length,
					},
					toUpdate: { users: 0, groups: 0, roles: 0 },
					conflicts: [],
				};
			}
			// ours: compute the diff against existing external data
			const ext = new SqlIdentityStore(conn.db, input.dialect);
			const existing = await ext.exportAll();
			const diff = this.diff(local, existing);
			return { reachable: true, ownership, schemaPresent: true, willWipeLocal, ...diff };
		} catch (error) {
			return {
				reachable: false,
				ownership: 'empty',
				schemaPresent: false,
				willWipeLocal: false,
				toCreate: { users: 0, groups: 0, roles: 0 },
				toUpdate: { users: 0, groups: 0, roles: 0 },
				conflicts: [],
				error: this.friendly(error),
			};
		} finally {
			await conn.destroy().catch(() => undefined);
		}
	}

	async connect(
		req: ConnectExternalDbRequest,
		actor?: { id?: string; label?: string },
	): Promise<ConnectExternalDbResponseDto> {
		this.acquireLock();
		try {
			const password = await this.resolvePassword(req.password);
			if (!password) {
				throw new BadRequestException('A database password is required to connect.');
			}
			const relocate = !req.keepLocalCopy;
			const dbConfig = this.toDbConfig(req, password);
			await this.upsertConfig(req, password, 'migrating');
			this.audit.recordSafe({
				category: 'identity',
				actorType: 'admin',
				event: 'identity_db_connected',
				actorId: actor?.id,
				actorLabel: actor?.label,
			});

			const conn = this.factory.create(dbConfig);
			let imported = { users: 0, groups: 0, roles: 0 };
			let localWiped = false;
			let backupPath: string | null = null;
			let wipeSkipped = false;
			try {
				const ownership = await classifyOwnership(conn.db);
				if (ownership === 'foreign') {
					throw new ConflictException(
						'The target database already has nestidp_ tables that are not ours.',
					);
				}
				await ensureSchema(conn.db, req.dialect, await this.instanceId(), req.pgSchema);
				const ext = new SqlIdentityStore(conn.db, req.dialect);

				// Pre-cutover conflict detection against pre-existing (ours) data.
				const local = await this.store.getLocal().exportAll();
				if (ownership === 'ours') {
					const existing = await ext.exportAll();
					const conflicts = this.diff(local, existing).conflicts;
					if (conflicts.length > 0) {
						throw new ConflictException(
							`Pre-existing data conflicts: ${conflicts.map((c) => `${c.table}.${c.kind}=${c.value}`).join(', ')}`,
						);
					}
				}

				await this.setProgress(
					'copying',
					0,
					local.users.length + local.groups.length + local.roles.length,
				);
				const counts = await ext.importSnapshot(local, 'upsert', (done, total) => {
					void this.setProgress('copying', done, total);
				});
				imported = {
					users: counts.usersInserted + counts.usersUpdated,
					groups: counts.groupsInserted + counts.groupsUpdated,
					roles: counts.rolesInserted + counts.rolesUpdated,
				};
				await this.setProgress('verify', imported.users, local.users.length);

				if (relocate) {
					if (req.acknowledgeBackup) {
						backupPath = await this.backupLocal();
						await this.store.getLocal().wipeAll();
						localWiped = true;
					} else {
						wipeSkipped = true;
					}
				}

				await this.markConnected(relocate ? 'relocate' : 'mirror');
				await this.activate(await this.loadConfig());
				this.audit.recordSafe({
					category: 'identity',
					actorType: 'admin',
					event: localWiped ? 'identity_db_local_wiped' : 'identity_db_cutover',
					actorId: actor?.id,
					actorLabel: actor?.label,
					metadata: { mode: relocate ? 'relocate' : 'mirror', imported, backupPath },
				});
			} catch (error) {
				await conn.destroy().catch(() => undefined);
				await this.markError(error);
				throw error;
			}

			return { status: await this.getStatus(), imported, localWiped, backupPath, wipeSkipped };
		} finally {
			this.releaseLock();
		}
	}

	async resync(actor?: { id?: string; label?: string }): Promise<ExternalDbStatusResponseDto> {
		this.acquireLock();
		try {
			const cfg = await this.loadConfig();
			if (!cfg || cfg.status !== 'active') {
				throw new BadRequestException('No active external identity database.');
			}
			if (cfg.mode === 'mirror' && this.active) {
				const ext = new SqlIdentityStore(this.active.db, cfg.dialect as 'postgres' | 'mysql');
				const local = await this.store.getLocal().exportAll();
				await ext.importSnapshot(local, 'upsert');
			}
			await this.prisma.externalIdentityDatabase.update({
				where: { id: CONFIG_ID },
				data: { outOfSync: false, lastSyncAt: new Date() },
			});
			this.audit.recordSafe({
				category: 'identity',
				actorType: 'admin',
				event: 'identity_db_resynced',
				actorId: actor?.id,
				actorLabel: actor?.label,
			});
			return this.getStatus();
		} finally {
			this.releaseLock();
		}
	}

	async disconnect(
		req: DisconnectExternalDbRequest,
		actor?: { id?: string; label?: string },
	): Promise<ExternalDbStatusResponseDto> {
		this.acquireLock();
		try {
			const cfg = await this.loadConfig();
			if (!cfg) {
				return this.getStatus();
			}
			const relocate = cfg.mode === 'relocate';
			if (relocate && !req.moveDataToLocal && !req.acknowledgeDataLoss) {
				throw new BadRequestException(
					'Detaching in relocate mode without moving data back leaves local identity empty — set acknowledgeDataLoss to confirm.',
				);
			}
			if (relocate && req.moveDataToLocal && this.active) {
				const ext = new SqlIdentityStore(this.active.db, cfg.dialect as 'postgres' | 'mysql');
				const snapshot = await ext.exportAll();
				await this.store.getLocal().importSnapshot(snapshot, 'upsert');
			}
			this.store.revertToLocal();
			this.stopProbe();
			await this.active?.destroy().catch(() => undefined);
			this.active = null;
			this.activeDialect = null;
			this.breaker = null;
			await this.prisma.externalIdentityDatabase
				.delete({ where: { id: CONFIG_ID } })
				.catch(() => undefined);
			this.audit.recordSafe({
				category: 'identity',
				actorType: 'admin',
				event: 'identity_db_disconnected',
				actorId: actor?.id,
				actorLabel: actor?.label,
				metadata: { movedDataToLocal: req.moveDataToLocal },
			});
			return this.getStatus();
		} finally {
			this.releaseLock();
		}
	}

	// --- internals ---

	private async activate(cfg: ExternalIdentityDatabase | null): Promise<void> {
		if (!cfg) {
			return;
		}
		this.stopProbe();
		await this.active?.destroy().catch(() => undefined);
		const password = this.encryption.decrypt(cfg.passwordEncrypted);
		this.active = this.factory.create(this.toDbConfigFromRow(cfg, password));
		await ensureSchema(
			this.active.db,
			cfg.dialect as 'postgres' | 'mysql',
			await this.instanceId(),
			cfg.pgSchema,
		);
		this.breaker = new CircuitBreaker();
		this.activeDialect = cfg.dialect as 'postgres' | 'mysql';
		const sql = new SqlIdentityStore(this.active.db, this.activeDialect, this.accountLockout);
		const resilient = withResilience(sql, this.breaker, cfg.queryTimeoutMs);
		if (cfg.mode === 'mirror') {
			this.store.setActive(
				createMirroringStore(this.store.getLocal(), () => this.requestMirrorReconcile()),
				'mirror',
			);
		} else {
			this.store.setActive(resilient, 'external');
		}
		await this.markReachable(true, null);
		this.startProbe(cfg.probeIntervalMs);
	}

	private startProbe(intervalMs: number): void {
		if (!intervalMs || intervalMs <= 0) {
			return;
		}
		this.probe = setInterval(() => {
			void this.runProbe();
		}, intervalMs);
		this.probe.unref?.();
	}

	private stopProbe(): void {
		if (this.probe) {
			clearInterval(this.probe);
			this.probe = null;
		}
	}

	private async runProbe(): Promise<void> {
		if (!this.active) {
			return;
		}
		try {
			await this.active.db.selectNoFrom((eb) => eb.lit(1).as('one')).execute();
			await this.markReachable(true, null);
		} catch (error) {
			await this.markReachable(false, this.msg(error));
		}
	}

	private flagDrift(): void {
		void this.prisma.externalIdentityDatabase
			.update({ where: { id: CONFIG_ID }, data: { outOfSync: true } })
			.catch(() => undefined);
	}

	/**
	 * Mirror write-through: after a local mutation, push the change to the external copy. Calls are
	 * coalesced (a burst of writes triggers one reconcile) and never block or fail the local write; a
	 * failed push leaves `outOfSync = true` for the Re-sync action.
	 */
	private requestMirrorReconcile(): void {
		this.flagDrift();
		this.mirrorQueued = true;
		if (!this.mirrorRunning) {
			this.mirrorRunning = this.drainMirrorReconcile();
		}
	}

	private async drainMirrorReconcile(): Promise<void> {
		try {
			while (this.mirrorQueued) {
				this.mirrorQueued = false;
				await this.runMirrorReconcileOnce();
			}
		} finally {
			this.mirrorRunning = null;
		}
	}

	private async runMirrorReconcileOnce(): Promise<void> {
		if (!this.active || !this.activeDialect) {
			return;
		}
		try {
			const ext = new SqlIdentityStore(this.active.db, this.activeDialect);
			const snapshot = await this.store.getLocal().exportAll();
			// Wipe + re-import keeps the external copy an exact mirror (handles deletes/updates/inserts).
			await ext.wipeAll();
			await ext.importSnapshot(snapshot, 'upsert');
			await this.prisma.externalIdentityDatabase
				.update({ where: { id: CONFIG_ID }, data: { outOfSync: false, lastSyncAt: new Date() } })
				.catch(() => undefined);
		} catch (error) {
			await this.prisma.externalIdentityDatabase
				.update({ where: { id: CONFIG_ID }, data: { outOfSync: true, lastError: this.msg(error) } })
				.catch(() => undefined);
		}
	}

	/** Test/ops helper: resolves once any pending mirror reconcile has finished. */
	async whenMirrorIdle(): Promise<void> {
		if (this.mirrorRunning) {
			await this.mirrorRunning;
		}
	}

	private diff(local: IdentitySnapshot, existing: IdentitySnapshot) {
		const exUserExt = new Set(existing.users.map((u) => `${u.apiConnectionId}|${u.externalId}`));
		const exGroupExt = new Set(existing.groups.map((g) => `${g.apiConnectionId}|${g.externalId}`));
		const exRoleExt = new Set(existing.roles.map((r) => `${r.apiConnectionId}|${r.externalId}`));
		const exUsernames = new Map(
			existing.users.map((u) => [u.username, `${u.apiConnectionId}|${u.externalId}`]),
		);
		const toCreate = { users: 0, groups: 0, roles: 0 };
		const toUpdate = { users: 0, groups: 0, roles: 0 };
		const conflicts: ExternalDbPreviewResponseDto['conflicts'] = [];
		for (const u of local.users) {
			const key = `${u.apiConnectionId}|${u.externalId}`;
			if (exUserExt.has(key)) {
				toUpdate.users += 1;
			} else {
				toCreate.users += 1;
				const owner = exUsernames.get(u.username);
				if (owner && owner !== key) {
					conflicts.push({ kind: 'username', table: 'user', value: u.username });
				}
			}
		}
		for (const g of local.groups) {
			if (exGroupExt.has(`${g.apiConnectionId}|${g.externalId}`)) {
				toUpdate.groups += 1;
			} else {
				toCreate.groups += 1;
			}
		}
		for (const r of local.roles) {
			if (exRoleExt.has(`${r.apiConnectionId}|${r.externalId}`)) {
				toUpdate.roles += 1;
			} else {
				toCreate.roles += 1;
			}
		}
		return { toCreate, toUpdate, conflicts };
	}

	private async backupLocal(): Promise<string> {
		const url = requireDatabaseUrl();
		const path = url.replace(/^file:/, '');
		const backupPath = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
		const client = createLibsqlClient();
		try {
			await client.execute(`VACUUM INTO 'file:${backupPath}'`);
		} finally {
			client.close();
		}
		this.logger.log(`Local database backed up to ${backupPath} before relocate wipe.`);
		return backupPath;
	}

	private async instanceId(): Promise<string> {
		const cfg = await this.loadConfig();
		return cfg?.id ?? CONFIG_ID;
	}

	private loadConfig(): Promise<ExternalIdentityDatabase | null> {
		return this.prisma.externalIdentityDatabase.findUnique({ where: { id: CONFIG_ID } });
	}

	private async safeCounts(): Promise<
		{ users: number; groups: number; roles: number } | undefined
	> {
		try {
			const [users, groups, roles] = await Promise.all([
				this.store.countUsers(),
				this.store.countGroups(),
				this.store.countRoles(),
			]);
			return { users, groups, roles };
		} catch {
			return undefined;
		}
	}

	private async resolvePassword(provided?: string): Promise<string> {
		if (provided && provided.length > 0) {
			return provided;
		}
		const cfg = await this.loadConfig();
		return cfg ? this.encryption.decrypt(cfg.passwordEncrypted) : '';
	}

	private toDbConfig(input: ExternalDbConnectionInput, password: string): ExternalDbConfig {
		return {
			dialect: input.dialect,
			host: input.host,
			port: input.port,
			database: input.database,
			username: input.username,
			password,
			sslMode: input.sslMode,
			sslCaCertPem: input.sslCaCertPem ?? null,
			pgSchema: input.pgSchema ?? null,
			poolMax: 10,
			connectTimeoutMs: 5000,
			queryTimeoutMs: 10_000,
		};
	}

	private toDbConfigFromRow(cfg: ExternalIdentityDatabase, password: string): ExternalDbConfig {
		return {
			dialect: cfg.dialect as 'postgres' | 'mysql',
			host: cfg.host,
			port: cfg.port,
			database: cfg.database,
			username: cfg.username,
			password,
			sslMode: cfg.sslMode as ExternalDbConfig['sslMode'],
			sslCaCertPem: cfg.sslCaCertPem,
			pgSchema: cfg.pgSchema,
			poolMax: cfg.poolMax,
			connectTimeoutMs: cfg.connectTimeoutMs,
			queryTimeoutMs: cfg.queryTimeoutMs,
		};
	}

	private async upsertConfig(
		req: ConnectExternalDbRequest,
		password: string,
		status: string,
	): Promise<void> {
		const passwordEncrypted = this.encryption.encrypt(password);
		const data = {
			dialect: req.dialect,
			host: req.host,
			port: req.port,
			database: req.database,
			username: req.username,
			passwordEncrypted,
			sslMode: req.sslMode,
			sslCaCertPem: req.sslCaCertPem ?? null,
			pgSchema: req.pgSchema ?? null,
			keepLocalCopy: !!req.keepLocalCopy,
			mode: req.keepLocalCopy ? 'mirror' : 'relocate',
			status,
			lastError: null,
		};
		await this.prisma.externalIdentityDatabase.upsert({
			where: { id: CONFIG_ID },
			create: { id: CONFIG_ID, ...data },
			update: data,
		});
	}

	private async markConnected(mode: string): Promise<void> {
		await this.prisma.externalIdentityDatabase.update({
			where: { id: CONFIG_ID },
			data: {
				status: 'active',
				mode,
				reachable: true,
				outOfSync: false,
				lastError: null,
				connectedAt: new Date(),
				lastSyncAt: new Date(),
				migrationPhase: null,
				migrationDone: 0,
				migrationTotal: 0,
			},
		});
	}

	private async markReachable(reachable: boolean, error: string | null): Promise<void> {
		await this.prisma.externalIdentityDatabase
			.update({
				where: { id: CONFIG_ID },
				data: { reachable, lastProbeAt: new Date(), lastProbeError: error },
			})
			.catch(() => undefined);
	}

	private async setProgress(phase: string, done: number, total: number): Promise<void> {
		await this.prisma.externalIdentityDatabase
			.update({
				where: { id: CONFIG_ID },
				data: { migrationPhase: phase, migrationDone: done, migrationTotal: total },
			})
			.catch(() => undefined);
	}

	private async markError(error: unknown): Promise<void> {
		await this.prisma.externalIdentityDatabase
			.update({ where: { id: CONFIG_ID }, data: { status: 'error', lastError: this.msg(error) } })
			.catch(() => undefined);
	}

	private acquireLock(): void {
		if (this.busy) {
			throw new ConflictException(
				'An external identity database operation is already in progress.',
			);
		}
		this.busy = true;
	}

	private releaseLock(): void {
		this.busy = false;
	}

	private msg(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private friendly(error: unknown): string {
		const m = this.msg(error).toLowerCase();
		if (/auth|password|role .* does not exist|access denied/.test(m)) {
			return 'Authentication failed — check the username and password.';
		}
		if (/econnrefused|timeout|ehostunreach|enotfound|connect/.test(m)) {
			return 'Could not reach the database host/port.';
		}
		if (/ssl|tls|certificate/.test(m)) {
			return 'TLS/SSL handshake failed — check sslMode and the CA certificate.';
		}
		return this.msg(error);
	}
}
