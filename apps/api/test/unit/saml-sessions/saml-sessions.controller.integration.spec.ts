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
import { ADMIN_CSRF_HEADER_NAME, SAML_SESSIONS_API_PATH } from '@nestidp/shared';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { BackchannelLogoutModule } from '@api/saml/backchannel-logout.module';
import {
	SamlSoapBackchannelService,
	type SoapDeliveryResult,
} from '@api/saml/services/saml-soap-backchannel.service';
import { SamlSessionsAdminModule } from '@api/saml-sessions/saml-sessions-admin.module';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestIdpSettingsWithSigningKey,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(120_000);

const UNKNOWN_CUID = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';

/**
 * Admin SAML-sessions controller over HTTP (Prompt 38 §8): list filters, single/bulk/by-user
 * termination, the terminate-all kill switch, back-channel resend/process/health, plus the CSRF,
 * authz and DTO-validation gates. Real Nest app + libSQL file DB + supertest agent login; the SOAP
 * dispatcher is mocked so back-channel outcomes are deterministic.
 */
describe('saml-sessions admin controller integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	let apiConnectionId: string;
	let userId: string;
	const adminPassword = 'sess-ctrl-admin-pass';

	const deliver = jest.fn<Promise<SoapDeliveryResult>, [unknown]>();
	const soapMock = { deliver } as unknown as SamlSoapBackchannelService;

	async function loginAgent(agent: ReturnType<typeof request.agent>) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return login.body.csrfToken as string;
	}

	function csrfHeader(token: string) {
		return { [ADMIN_CSRF_HEADER_NAME]: token };
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sess-ctrl-${randomUUID()}.db`);
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
							SAML_SESSION_CLEANUP_INTERVAL_MS: 0,
							// manual control: terminate never delivers inline, no retry scheduler — the
							// process-backchannel endpoint drives delivery in these tests
							SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS: 0,
							SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS: 0,
							SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES: 2,
						}),
					],
				}),
				PrismaModule,
				AdminAuthModule,
				BackchannelLogoutModule,
				SamlSessionsAdminModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.overrideProvider(SamlSoapBackchannelService)
			.useValue(soapMock)
			.compile();

		app = moduleFixture.createNestApplication();
		app.use(cookieParser());
		await app.init();

		prisma = app.get(PrismaService);
		await createTestAdminUserWithPassword(prisma, 'admin', adminPassword);
		await createTestIdpSettingsWithSigningKey(prisma, { entityId: 'http://localhost:3000' });
		const apiConnection = await createTestApiConnection(prisma, { name: 'Sessions Source' });
		apiConnectionId = apiConnection.id;
		const user = await createTestUser(prisma, apiConnectionId, { username: 'session-owner' });
		userId = user.id;
	});

	beforeEach(async () => {
		deliver.mockReset();
		app.get(LoginProtectionService).clear();
		// FK order: queue → participation → session → sp
		await prisma.samlBackchannelLogout.deleteMany();
		await prisma.samlSpParticipation.deleteMany();
		await prisma.samlSsoSession.deleteMany();
		await prisma.spConnection.deleteMany();
		await prisma.auditEvent.deleteMany();
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	let spSeq = 0;
	async function makeSp(sloSoapUrl: string | null = null) {
		spSeq += 1;
		return prisma.spConnection.create({
			data: {
				name: `SP-${spSeq}`,
				spEntityId: `https://sp-${spSeq}-${randomUUID()}.example.com`,
				acsUrl: 'https://sp.example.com/acs',
				spCertificate: 'PEM',
				sloSoapUrl,
			},
		});
	}

	async function makeSession(
		username = 'user',
		overrides: { status?: string; userId?: string | null } = {},
	) {
		return prisma.samlSsoSession.create({
			data: {
				username,
				userId: overrides.userId ?? null,
				status: overrides.status ?? 'active',
				expiresAt: new Date(Date.now() + 3_600_000),
			},
		});
	}

	async function participate(sessionId: string, spId: string) {
		return prisma.samlSpParticipation.create({
			data: {
				ssoSessionId: sessionId,
				spConnectionId: spId,
				sessionIndex: `_idx-${spId}`,
				nameId: 'user@example.com',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			},
		});
	}

	// --- authz -----------------------------------------------------------------------------------

	it('API-SESS-CTRL-01: unauthenticated GET list → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(SAML_SESSIONS_API_PATH)
			.expect(401);
	});

	it('API-SESS-CTRL-02: every endpoint rejects without an admin session → 401', async () => {
		const server = request(app.getHttpServer() as App);
		await server.get(`${SAML_SESSIONS_API_PATH}/backchannel-health`).expect(401);
		await server.post(`${SAML_SESSIONS_API_PATH}/${UNKNOWN_CUID}/terminate`).expect(401);
		await server
			.post(`${SAML_SESSIONS_API_PATH}/terminate`)
			.send({ ids: ['x'] })
			.expect(401);
		await server
			.post(`${SAML_SESSIONS_API_PATH}/terminate-by-user`)
			.send({ userId: 'u' })
			.expect(401);
		await server.post(`${SAML_SESSIONS_API_PATH}/terminate-all`).expect(401);
		await server
			.post(`${SAML_SESSIONS_API_PATH}/${UNKNOWN_CUID}/resend-backchannel/${UNKNOWN_CUID}`)
			.expect(401);
		await server.post(`${SAML_SESSIONS_API_PATH}/process-backchannel`).expect(401);
	});

	// --- CSRF ------------------------------------------------------------------------------------

	it('API-SESS-CTRL-03: every mutating POST without the CSRF header → 403', async () => {
		const session = await makeSession();
		const sp = await makeSp();
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		await agent.post(`${SAML_SESSIONS_API_PATH}/${session.id}/terminate`).expect(403);
		await agent
			.post(`${SAML_SESSIONS_API_PATH}/terminate`)
			.send({ ids: [session.id] })
			.expect(403);
		await agent.post(`${SAML_SESSIONS_API_PATH}/terminate-by-user`).send({ userId }).expect(403);
		await agent.post(`${SAML_SESSIONS_API_PATH}/terminate-all`).expect(403);
		await agent
			.post(`${SAML_SESSIONS_API_PATH}/${session.id}/resend-backchannel/${sp.id}`)
			.expect(403);
		await agent.post(`${SAML_SESSIONS_API_PATH}/process-backchannel`).expect(403);

		// nothing happened
		const row = await prisma.samlSsoSession.findUniqueOrThrow({ where: { id: session.id } });
		expect(row.status).toBe('active');
	});

	// --- list + filters ----------------------------------------------------------------------------

	it('API-SESS-CTRL-04: GET list defaults to active sessions and includes participations', async () => {
		const sp = await makeSp();
		const active = await makeSession('alice');
		await participate(active.id, sp.id);
		await makeSession('bob', { status: 'terminated' });

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const res = await agent.get(SAML_SESSIONS_API_PATH).expect(200);

		expect(res.body.total).toBe(1);
		expect(res.body.items).toHaveLength(1);
		expect(res.body.items[0].id).toBe(active.id);
		expect(res.body.items[0].username).toBe('alice');
		expect(res.body.items[0].participations).toHaveLength(1);
		expect(res.body.items[0].participations[0].spConnectionId).toBe(sp.id);
	});

	it('API-SESS-CTRL-05: status=terminated and status=all filters', async () => {
		await makeSession('alice');
		await makeSession('bob', { status: 'terminated' });

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const terminated = await agent.get(`${SAML_SESSIONS_API_PATH}?status=terminated`).expect(200);
		expect(terminated.body.total).toBe(1);
		expect(terminated.body.items[0].username).toBe('bob');

		const all = await agent.get(`${SAML_SESSIONS_API_PATH}?status=all`).expect(200);
		expect(all.body.total).toBe(2);

		// junk status falls back to active
		const junk = await agent.get(`${SAML_SESSIONS_API_PATH}?status=banana`).expect(200);
		expect(junk.body.total).toBe(1);
		expect(junk.body.items[0].username).toBe('alice');
	});

	it('API-SESS-CTRL-06: spConnectionId filter scopes to that SP participations', async () => {
		const spA = await makeSp();
		const spB = await makeSp();
		const sessionA = await makeSession('alice');
		await participate(sessionA.id, spA.id);
		const sessionB = await makeSession('bob');
		await participate(sessionB.id, spB.id);

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const res = await agent.get(`${SAML_SESSIONS_API_PATH}?spConnectionId=${spA.id}`).expect(200);
		expect(res.body.total).toBe(1);
		expect(res.body.items[0].id).toBe(sessionA.id);
	});

	it('API-SESS-CTRL-07: apiConnectionId filter scopes to that identity source and labels it', async () => {
		await makeSession('session-owner', { userId });
		await makeSession('orphan');

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const res = await agent
			.get(`${SAML_SESSIONS_API_PATH}?apiConnectionId=${apiConnectionId}`)
			.expect(200);
		expect(res.body.total).toBe(1);
		expect(res.body.items[0].username).toBe('session-owner');
		expect(res.body.items[0].sourceApiConnectionId).toBe(apiConnectionId);
		expect(res.body.items[0].sourceLabel).toBe('Sessions Source');
	});

	it('API-SESS-CTRL-08: q search matches username; non-matching term returns an empty page', async () => {
		await makeSession('alice');
		await makeSession('bob');

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const hit = await agent.get(`${SAML_SESSIONS_API_PATH}?q=ali`).expect(200);
		expect(hit.body.total).toBe(1);
		expect(hit.body.items[0].username).toBe('alice');

		const miss = await agent.get(`${SAML_SESSIONS_API_PATH}?q=zzz-no-match`).expect(200);
		expect(miss.body.total).toBe(0);
		expect(miss.body.items).toEqual([]);
	});

	it('API-SESS-CTRL-09: pagination via page/pageSize; junk values fall back to defaults', async () => {
		for (let i = 0; i < 3; i += 1) {
			await makeSession(`user-${i}`);
		}

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);

		const pageOne = await agent.get(`${SAML_SESSIONS_API_PATH}?page=1&pageSize=2`).expect(200);
		expect(pageOne.body.total).toBe(3);
		expect(pageOne.body.items).toHaveLength(2);

		const pageTwo = await agent.get(`${SAML_SESSIONS_API_PATH}?page=2&pageSize=2`).expect(200);
		expect(pageTwo.body.items).toHaveLength(1);

		// junk paging input must not 500 and falls back to page 1 / default page size
		const junk = await agent.get(`${SAML_SESSIONS_API_PATH}?page=banana&pageSize=-5`).expect(200);
		expect(junk.body.total).toBe(3);
		expect(junk.body.items).toHaveLength(3);
	});

	// --- single terminate ---------------------------------------------------------------------------

	it('API-SESS-CTRL-10: POST :id/terminate terminates the session and records the admin actor', async () => {
		const session = await makeSession();
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/${session.id}/terminate`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toEqual({ ok: true, id: session.id, alreadyTerminated: false });

		const row = await prisma.samlSsoSession.findUniqueOrThrow({ where: { id: session.id } });
		expect(row.status).toBe('terminated');
		expect(row.terminatedReason).toBe('admin_action');
		expect(row.terminatedByAdminId).not.toBeNull();
	});

	it('API-SESS-CTRL-11: re-terminating reports alreadyTerminated (idempotent)', async () => {
		const session = await makeSession('again', { status: 'terminated' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/${session.id}/terminate`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body.alreadyTerminated).toBe(true);
	});

	it('API-SESS-CTRL-12: terminate with a malformed id → 400 (cuid pipe)', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(`${SAML_SESSIONS_API_PATH}/not-a-cuid/terminate`)
			.set(csrfHeader(csrf))
			.expect(400);
	});

	it('API-SESS-CTRL-13: terminate with an unknown (but valid) cuid still answers ok:true', async () => {
		// Pins current behavior: the controller discards the service's `found:false`, so a nonexistent
		// id is indistinguishable from a fresh termination in the response (report-only observation).
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/${UNKNOWN_CUID}/terminate`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toEqual({ ok: true, id: UNKNOWN_CUID, alreadyTerminated: false });
	});

	// --- bulk terminate ------------------------------------------------------------------------------

	it('API-SESS-CTRL-14: bulk terminate reports per-id outcomes and the terminated count', async () => {
		const active = await makeSession('active');
		const done = await makeSession('done', { status: 'terminated' });
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/terminate`)
			.set(csrfHeader(csrf))
			.send({ ids: [active.id, done.id, UNKNOWN_CUID] })
			.expect(200);

		expect(res.body.ok).toBe(true);
		expect(res.body.terminatedCount).toBe(1);
		expect(res.body.results).toEqual([
			{ id: active.id, outcome: 'terminated' },
			{ id: done.id, outcome: 'already_terminated' },
			{ id: UNKNOWN_CUID, outcome: 'not_found' },
		]);
	});

	it('API-SESS-CTRL-15: bulk DTO validation — empty/missing/oversized/typed/extra → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const post = () => agent.post(`${SAML_SESSIONS_API_PATH}/terminate`).set(csrfHeader(csrf));

		await post().send({}).expect(400); // ids missing
		await post().send({ ids: [] }).expect(400); // ArrayNotEmpty
		await post().send({ ids: 'not-an-array' }).expect(400); // IsArray
		await post()
			.send({ ids: [42] })
			.expect(400); // IsString each
		await post()
			.send({ ids: ['a'.repeat(65)] })
			.expect(400); // MaxLength each
		await post()
			.send({ ids: Array.from({ length: 501 }, (_, i) => `id-${i}`) })
			.expect(400); // ArrayMaxSize
		await post()
			.send({ ids: [UNKNOWN_CUID], extra: true })
			.expect(400); // forbidNonWhitelisted
	});

	// --- terminate by user ---------------------------------------------------------------------------

	it('API-SESS-CTRL-16: terminate-by-user terminates only that user sessions', async () => {
		await makeSession('session-owner', { userId });
		await makeSession('session-owner', { userId });
		const other = await makeSession('other-user');

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/terminate-by-user`)
			.set(csrfHeader(csrf))
			.send({ userId })
			.expect(200);

		expect(res.body).toEqual({ ok: true, userId, terminatedCount: 2 });
		const untouched = await prisma.samlSsoSession.findUniqueOrThrow({ where: { id: other.id } });
		expect(untouched.status).toBe('active');
	});

	it('API-SESS-CTRL-17: terminate-by-user DTO validation → 400', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const post = () =>
			agent.post(`${SAML_SESSIONS_API_PATH}/terminate-by-user`).set(csrfHeader(csrf));

		await post().send({}).expect(400); // userId missing
		await post().send({ userId: '' }).expect(400); // IsNotEmpty
		await post()
			.send({ userId: 'a'.repeat(65) })
			.expect(400); // MaxLength
		await post().send({ userId, role: 'super' }).expect(400); // forbidNonWhitelisted
	});

	// --- kill switch ----------------------------------------------------------------------------------

	it('API-SESS-CTRL-18: terminate-all kills every active session and counts only fresh terminations', async () => {
		await makeSession('one');
		await makeSession('two');
		await makeSession('done', { status: 'terminated' });

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/terminate-all`)
			.set(csrfHeader(csrf))
			.expect(200);

		expect(res.body).toEqual({ ok: true, terminatedCount: 2 });
		expect(await prisma.samlSsoSession.count({ where: { status: 'active' } })).toBe(0);

		// second pull of the kill switch is a no-op
		const again = await agent
			.post(`${SAML_SESSIONS_API_PATH}/terminate-all`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(again.body.terminatedCount).toBe(0);
	});

	// --- back-channel resend / process / health --------------------------------------------------------

	it('API-SESS-CTRL-19: resend resets a given-up delivery and process-backchannel delivers it', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await prisma.samlBackchannelLogout.create({
			data: {
				ssoSessionId: session.id,
				spConnectionId: sp.id,
				sessionIndex: `_idx-${sp.id}`,
				nameId: 'user@example.com',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				reason: 'admin_action',
				status: 'given_up',
				attempts: 3,
				requestId: '_req-giveup',
			},
		});

		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		const resend = await agent
			.post(`${SAML_SESSIONS_API_PATH}/${session.id}/resend-backchannel/${sp.id}`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(resend.body).toEqual({ ok: true, ssoSessionId: session.id, spConnectionId: sp.id });

		let row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('pending');
		expect(row.attempts).toBe(0);

		deliver.mockResolvedValue({ outcome: 'succeeded' });
		const processed = await agent
			.post(`${SAML_SESSIONS_API_PATH}/process-backchannel`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(processed.body).toEqual({ ok: true, processed: 1 });

		row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('succeeded');
		expect(deliver).toHaveBeenCalledTimes(1);
	});

	it('API-SESS-CTRL-20: resend with malformed path ids → 400 (cuid pipes on both params)', async () => {
		const session = await makeSession();
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);

		await agent
			.post(`${SAML_SESSIONS_API_PATH}/not-a-cuid/resend-backchannel/${UNKNOWN_CUID}`)
			.set(csrfHeader(csrf))
			.expect(400);
		await agent
			.post(`${SAML_SESSIONS_API_PATH}/${session.id}/resend-backchannel/not-a-cuid`)
			.set(csrfHeader(csrf))
			.expect(400);
	});

	it('API-SESS-CTRL-21: process-backchannel with nothing due → processed 0', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/process-backchannel`)
			.set(csrfHeader(csrf))
			.expect(200);
		expect(res.body).toEqual({ ok: true, processed: 0 });
		expect(deliver).not.toHaveBeenCalled();
	});

	it('API-SESS-CTRL-22: backchannel-health reflects the queue status counts', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const base = {
			spConnectionId: sp.id,
			sessionIndex: '_idx',
			nameId: 'user@example.com',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			reason: 'admin_action',
		};
		const statuses = ['pending', 'failed', 'given_up', 'succeeded', 'skipped_no_endpoint'];
		for (const status of statuses) {
			const session = await makeSession(`health-${status}`);
			await prisma.samlBackchannelLogout.create({
				data: { ...base, ssoSessionId: session.id, status },
			});
		}

		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		const res = await agent.get(`${SAML_SESSIONS_API_PATH}/backchannel-health`).expect(200);

		expect(res.body).toEqual({
			pending: 1,
			inFlight: 0,
			succeeded: 1,
			partial: 0,
			failed: 1,
			givenUp: 1,
			skipped: 1,
		});
	});
});

/**
 * Same controller without the @Global BackchannelLogoutModule — the @Optional propagation dependency
 * is absent (the Prompt 36 degenerate wiring): resend must answer 503 and process must no-op.
 */
describe('saml-sessions admin controller without back-channel module (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'sess-ctrl-nobc-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sess-ctrl-nobc-${randomUUID()}.db`);
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
						}),
					],
				}),
				PrismaModule,
				AdminAuthModule,
				SamlSessionsAdminModule,
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

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	async function loginAgent(agent: ReturnType<typeof request.agent>) {
		const login = await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return login.body.csrfToken as string;
	}

	it('API-SESS-CTRL-23: resend without the propagation engine → 503', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		await agent
			.post(`${SAML_SESSIONS_API_PATH}/${UNKNOWN_CUID}/resend-backchannel/${UNKNOWN_CUID}`)
			.set({ [ADMIN_CSRF_HEADER_NAME]: csrf })
			.expect(503);
	});

	it('API-SESS-CTRL-24: process-backchannel without the propagation engine → processed 0', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		const res = await agent
			.post(`${SAML_SESSIONS_API_PATH}/process-backchannel`)
			.set({ [ADMIN_CSRF_HEADER_NAME]: csrf })
			.expect(200);
		expect(res.body).toEqual({ ok: true, processed: 0 });
	});
});
