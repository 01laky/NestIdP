import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AUDIT_EVENTS_API_PATH, AUDIT_EXPORT_MAX_ROWS } from '@nestidp/shared';
import { AdminModule } from '@api/admin/admin.module';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { createTestAdminUserWithPassword } from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';
import { AuditQueryService } from '@api/audit/services/audit-query.service';
import { AuditRetentionCleanupService } from '@api/audit/services/audit-retention-cleanup.service';

jest.setTimeout(60_000);

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

async function waitForAuditEvent(prisma: PrismaService, event: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const row = await prisma.auditEvent.findFirst({
			where: { event },
		});
		if (row) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return null;
}

describe('audit integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'integration-admin-pass';

	async function loginAgent(agent: ReturnType<typeof request.agent>) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return login.body.csrfToken as string;
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-audit-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);

		const prismaService = new PrismaService({
			datasources: { db: { url: databaseUrl } },
		});

		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [
						() => ({
							DATABASE_URL: databaseUrl,
							SESSION_SECRET: 'test-session-secret-min-16',
							ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
							AUDIT_RETENTION_DAYS: '1',
							AUDIT_CLEANUP_INTERVAL_MS: '0',
						}),
					],
				}),
				PrismaModule,
				AdminAuthModule,
				AdminModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();

		prisma = app.get(PrismaService);
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
	});

	beforeEach(async () => {
		app.get(LoginProtectionService).clear();
		await prisma.auditEvent.deleteMany();
	});

	afterAll(async () => {
		await app.close();
		const filePath = databaseUrl.replace(/^file:/, '');
		try {
			unlinkSync(filePath);
		} catch {
			// ignore
		}
	});

	it('API-AUD-01: unauthenticated GET list → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(AUDIT_EVENTS_API_PATH)
			.expect(401);
	});

	it('API-AUD-02: login → GET list returns admin_login_success event', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await flushPromises();

		const list = await agent.get(AUDIT_EVENTS_API_PATH).expect(200);
		expect(list.body.total).toBeGreaterThanOrEqual(1);
		expect(
			list.body.items.some((row: { event: string }) => row.event === 'admin_login_success'),
		).toBe(true);
	});

	it('API-AUD-03: filter by category=admin_auth', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'sync',
			event: 'sync_completed',
			actorType: 'system',
		});
		audit.recordSafe({
			category: 'admin_auth',
			event: 'admin_login_failure',
			actorType: 'admin',
			actorLabel: 'ghost',
		});
		await flushPromises();

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const list = await agent.get(`${AUDIT_EVENTS_API_PATH}?category=admin_auth`).expect(200);

		expect(
			list.body.items.every((row: { category: string }) => row.category === 'admin_auth'),
		).toBe(true);
		expect(
			list.body.items.some((row: { event: string }) => row.event === 'admin_login_failure'),
		).toBe(true);
	});

	it('API-AUD-04: filter by event name', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_created',
			actorType: 'admin',
		});
		audit.recordSafe({
			category: 'admin_config',
			event: 'sp_connection_created',
			actorType: 'admin',
		});
		await flushPromises();

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const list = await agent
			.get(`${AUDIT_EVENTS_API_PATH}?event=api_connection_created`)
			.expect(200);

		expect(list.body.items).toHaveLength(1);
		expect(list.body.items[0].event).toBe('api_connection_created');
	});

	it('API-AUD-05: filter by since and until date range', async () => {
		const middle = await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'range_probe',
				actorType: 'admin',
				createdAt: new Date('2026-03-15T12:00:00.000Z'),
			},
		});
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'outside_range',
				actorType: 'admin',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const list = await agent
			.get(`${AUDIT_EVENTS_API_PATH}?since=2026-03-01T00:00:00.000Z&until=2026-03-31T23:59:59.999Z`)
			.expect(200);

		expect(list.body.items).toHaveLength(1);
		expect(list.body.items[0].id).toBe(middle.id);
	});

	it('API-AUD-06: export json returns items and exportedAt', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'saml',
			event: 'saml_sso_success',
			actorType: 'end_user',
		});
		await flushPromises();

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const exported = await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=json`).expect(200);

		expect(exported.body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(
			exported.body.items.some((row: { event: string }) => row.event === 'saml_sso_success'),
		).toBe(true);
	});

	it('API-AUD-07: export csv returns text/csv with header row', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'sync',
			event: 'sync_started',
			actorType: 'system',
		});
		await flushPromises();

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const exported = await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=csv`).expect(200);

		expect(exported.headers['content-type']).toMatch(/text\/csv/);
		expect(String(exported.text).split('\n')[0]).toBe(
			'id,createdAt,category,event,actorType,actorLabel,subjectType,subjectId,clientIp,metadata',
		);
		expect(String(exported.text)).toContain('sync_started');
	});

	it('API-AUD-08: export csv sets Content-Disposition attachment filename', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const exported = await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=csv`).expect(200);

		expect(exported.headers['content-disposition']).toMatch(
			/attachment; filename="nestidp-audit-.*\.csv"/,
		);
	});

	it('API-AUD-09: login failure persists admin_login_failure audit row', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: 'wrong-password-value' })
			.expect(401);

		await flushPromises();

		const row = await waitForAuditEvent(prisma, 'admin_login_failure');
		expect(row).not.toBeNull();
		expect(row!.category).toBe('admin_auth');
	});

	it('API-AUD-10: metadata sanitizer strips denylisted keys from persisted rows', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'admin_config',
			event: 'metadata_sanitize_probe',
			actorType: 'admin',
			metadata: {
				name: 'Corp',
				password: 'must-not-persist',
				bearerToken: 'must-not-persist',
			},
		});
		await flushPromises();

		const row = await waitForAuditEvent(prisma, 'metadata_sanitize_probe');
		expect(row).not.toBeNull();
		expect(row!.metadata).toEqual({ name: 'Corp' });
	});

	it('API-AUD-11: retention purge deletes events older than retention window', async () => {
		const old = await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'stale_event',
				actorType: 'admin',
			},
		});
		await prisma.auditEvent.update({
			where: { id: old.id },
			data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
		});
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'fresh_event',
				actorType: 'admin',
			},
		});

		const deleted = await app.get(AuditRetentionCleanupService).purgeExpired();
		expect(deleted).toBe(1);

		const remaining = await prisma.auditEvent.findMany();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].event).toBe('fresh_event');
	});

	it('API-AUD-12: export json sets truncated when row count hits export cap', async () => {
		const queryService = app.get(AuditQueryService);
		jest.spyOn(prisma.auditEvent, 'findMany').mockResolvedValueOnce(
			Array.from({ length: AUDIT_EXPORT_MAX_ROWS }, (_, index) => ({
				id: `export-cap-${index}`,
				category: 'admin_config',
				event: 'export_cap_probe',
				actorType: 'admin',
				actorId: null,
				actorLabel: null,
				subjectType: null,
				subjectId: null,
				clientIp: null,
				metadata: null,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
			})),
		);

		const body = await queryService.exportJson({});
		expect(body.items).toHaveLength(AUDIT_EXPORT_MAX_ROWS);
		expect(body.truncated).toBe(true);
	});

	it('API-AUD-13: list supports limit and offset pagination', async () => {
		for (let index = 0; index < 5; index += 1) {
			await prisma.auditEvent.create({
				data: {
					category: 'admin_config',
					event: `page_event_${index}`,
					actorType: 'admin',
				},
			});
		}

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const page = await agent.get(`${AUDIT_EVENTS_API_PATH}?limit=2&offset=1`).expect(200);

		expect(page.body.limit).toBe(2);
		expect(page.body.offset).toBe(1);
		expect(page.body.items).toHaveLength(2);
		expect(page.body.total).toBeGreaterThanOrEqual(5);
	});

	it('API-AUD-14: invalid category query → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?category=not_a_category`).expect(400);
	});

	it('API-AUD-15: limit above max 100 → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?limit=101`).expect(400);
	});

	it('API-AUD-16: negative offset → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?offset=-1`).expect(400);
	});

	it('API-AUD-26: garbage since/until → 400 (must be ISO 8601)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?since=not-a-date`).expect(400);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?until=garbage`).expect(400);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?since=2026-01-01T00:00:00.000Z`).expect(200);
	});

	it('API-AUD-17: export without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=json`)
			.expect(401);
	});

	it('API-AUD-18: export invalid format → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=xml`).expect(400);
	});

	it('API-AUD-19: export json respects category filter', async () => {
		await prisma.auditEvent.create({
			data: { category: 'saml', event: 'saml_only', actorType: 'system' },
		});
		await prisma.auditEvent.create({
			data: { category: 'sync', event: 'sync_only', actorType: 'system' },
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=json&category=saml`)
			.expect(200);

		expect(exported.body.items.every((row: { category: string }) => row.category === 'saml')).toBe(
			true,
		);
	});

	it('API-AUD-20: list returns numeric total and items array after login audit', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await flushPromises();
		const list = await agent.get(AUDIT_EVENTS_API_PATH).expect(200);
		expect(typeof list.body.total).toBe('number');
		expect(Array.isArray(list.body.items)).toBe(true);
		expect(list.body.total).toBeGreaterThanOrEqual(1);
	});

	it('API-AUD-21: list response items never expose denylisted metadata keys', async () => {
		const audit = app.get(AuditPersistenceService);
		audit.recordSafe({
			category: 'admin_config',
			event: 'list_metadata_probe',
			actorType: 'admin',
			metadata: { safe: 'ok', password: 'hidden', bearerToken: 'hidden' },
		});
		await flushPromises();
		await waitForAuditEvent(prisma, 'list_metadata_probe');

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const list = await agent.get(AUDIT_EVENTS_API_PATH).expect(200);
		const row = list.body.items.find(
			(item: { event: string }) => item.event === 'list_metadata_probe',
		);
		expect(row.metadata).toEqual({ safe: 'ok' });
		expect(JSON.stringify(list.body)).not.toContain('hidden');
	});

	it('API-AUD-22: export GET succeeds without CSRF header', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=json`).expect(200);
	});

	it('API-AUD-23: since-only filter excludes older events', async () => {
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'old_probe',
				actorType: 'admin',
				createdAt: new Date('2020-01-01T00:00:00.000Z'),
			},
		});
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'new_probe',
				actorType: 'admin',
				createdAt: new Date('2026-06-01T00:00:00.000Z'),
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const list = await agent
			.get(`${AUDIT_EVENTS_API_PATH}?since=2026-01-01T00:00:00.000Z`)
			.expect(200);

		expect(list.body.items.some((row: { event: string }) => row.event === 'new_probe')).toBe(true);
		expect(list.body.items.some((row: { event: string }) => row.event === 'old_probe')).toBe(false);
	});

	it('API-AUD-24: export defaults to json when format omitted', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent.get(`${AUDIT_EVENTS_API_PATH}/export`).expect(200);
		expect(exported.body.exportedAt).toBeDefined();
		expect(Array.isArray(exported.body.items)).toBe(true);
	});

	it('API-AUD-25: forbidNonWhitelisted query param → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.get(`${AUDIT_EVENTS_API_PATH}?evil=1`).expect(400);
	});

	it('API-AUD-EXP-01: export json includes filters echo', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(
				`${AUDIT_EVENTS_API_PATH}/export?format=json&category=admin_auth&event=admin_login_success`,
			)
			.expect(200);
		expect(exported.body.filters.category).toBe('admin_auth');
		expect(exported.body.filters.event).toBe('admin_login_success');
	});

	it('API-AUD-EXP-02: export csv contains only filtered events', async () => {
		await prisma.auditEvent.create({
			data: { category: 'sync', event: 'sync_csv', actorType: 'system' },
		});
		await prisma.auditEvent.create({
			data: { category: 'admin_auth', event: 'auth_csv', actorType: 'admin' },
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=csv&category=admin_auth`)
			.expect(200);

		expect(String(exported.text)).toContain('auth_csv');
		expect(String(exported.text)).not.toContain('sync_csv');
	});

	it('API-AUD-EXP-03: export json Content-Type is application/json', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent.get(`${AUDIT_EVENTS_API_PATH}/export?format=json`).expect(200);
		expect(exported.headers['content-type']).toMatch(/application\/json/);
	});

	it('API-AUD-EXP-04: export with until only returns events before cutoff', async () => {
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'until_old',
				actorType: 'admin',
				createdAt: new Date('2025-01-01T00:00:00.000Z'),
			},
		});
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'until_new',
				actorType: 'admin',
				createdAt: new Date('2027-01-01T00:00:00.000Z'),
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=json&until=2026-12-31T23:59:59.999Z`)
			.expect(200);

		const events = exported.body.items.map((row: { event: string }) => row.event);
		expect(events).toContain('until_old');
		expect(events).not.toContain('until_new');
	});

	it('API-AUD-EXP-05: export csv row includes actorLabel column', async () => {
		await prisma.auditEvent.create({
			data: {
				category: 'admin_auth',
				event: 'csv_label',
				actorType: 'admin',
				actorLabel: 'operator',
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=csv&event=csv_label`)
			.expect(200);

		expect(String(exported.text)).toContain('operator');
	});

	it('API-AUD-EXP-06: export json items match list DTO shape', async () => {
		await prisma.auditEvent.create({
			data: {
				category: 'saml',
				event: 'shape_probe',
				actorType: 'end_user',
				actorId: 'u1',
				actorLabel: 'alice',
				clientIp: '10.0.0.5',
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=json&event=shape_probe`)
			.expect(200);

		expect(exported.body.items[0]).toMatchObject({
			category: 'saml',
			event: 'shape_probe',
			actorType: 'end_user',
			actorLabel: 'alice',
			clientIp: '10.0.0.5',
		});
		expect(exported.body.items[0]).not.toHaveProperty('passwordHash');
	});

	it('API-AUD-EXP-07: export with zero rows returns empty items array', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const exported = await agent
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=json&event=nonexistent_event_xyz`)
			.expect(200);
		expect(exported.body.items).toEqual([]);
	});

	it('API-AUD-EXP-08: export csv without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(`${AUDIT_EVENTS_API_PATH}/export?format=csv`)
			.expect(401);
	});
});
