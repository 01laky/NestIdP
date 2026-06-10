import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { BackchannelLogoutModule } from '@api/saml/backchannel-logout.module';
import { LogoutPropagationService } from '@api/saml/services/logout-propagation.service';
import {
	SamlSoapBackchannelService,
	type SoapDeliveryResult,
} from '@api/saml/services/saml-soap-backchannel.service';
import { LOGOUT_PROPAGATION_NOTIFIER } from '@api/saml/services/logout-propagation-notifier';
import { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { SamlSsoSessionService } from '@api/saml-sessions/services/saml-sso-session.service';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { createTestIdpSettings } from '@test/support/prisma/test-fixtures';

jest.setTimeout(120_000);

/**
 * Back-channel (SOAP) SLO propagation engine — delivery lifecycle (Prompt 36, BC-PROP / BC-SPINIT).
 * The SOAP dispatcher is mocked so delivery outcomes are deterministic; everything else (queue, retry,
 * backoff, give-up, in-flight cap, prune, audit, notifier, SP degraded indicator) is real against SQLite.
 */
describe('back-channel logout engine (SQLite, mocked SOAP)', () => {
	let moduleRef: TestingModule;
	let prisma: PrismaService;
	let sessions: SamlSsoSessionService;
	let propagation: LogoutPropagationService;

	const deliver = jest.fn<Promise<SoapDeliveryResult>, [unknown]>();
	const soapMock = { deliver } as unknown as SamlSoapBackchannelService;
	const notifier = {
		onSent: jest.fn(),
		onSucceeded: jest.fn(),
		onFailed: jest.fn(),
		onGivenUp: jest.fn(),
	};
	const recordSafe = jest.fn();

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-bclo-engine-${randomUUID()}.db`);
		const databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		const prismaService = new PrismaService({ datasources: { db: { url: databaseUrl } } });

		moduleRef = await Test.createTestingModule({
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
							// Manual control: no inline first pass, no retry scheduler — we drive processDue() ourselves.
							SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS: 0,
							SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS: 0,
							SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES: 2,
							SAML_BACKCHANNEL_LOGOUT_RETRY_BASE_MS: 1_000,
							SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 2,
							SAML_BACKCHANNEL_LOGOUT_MAX_INFLIGHT: 5,
							// §5.C: must thread into the SOAP verifier options instead of a hardcoded 60.
							SAML_CLOCK_SKEW_SECONDS: 99,
						}),
					],
				}),
				PrismaModule,
				BackchannelLogoutModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.overrideProvider(SamlSoapBackchannelService)
			.useValue(soapMock)
			.overrideProvider(LOGOUT_PROPAGATION_NOTIFIER)
			.useValue(notifier)
			.overrideProvider(AuditPersistenceService)
			.useValue({ recordSafe })
			.compile();

		prisma = moduleRef.get(PrismaService);
		sessions = moduleRef.get(SamlSsoSessionService);
		propagation = moduleRef.get(LogoutPropagationService);
		await moduleRef.init();
		await createTestIdpSettings(prisma, { entityId: 'http://localhost:3000' });
	});

	afterAll(async () => {
		await moduleRef.close();
	});

	beforeEach(async () => {
		deliver.mockReset();
		notifier.onSent.mockReset();
		notifier.onSucceeded.mockReset();
		notifier.onFailed.mockReset();
		notifier.onGivenUp.mockReset();
		recordSafe.mockReset();
		// Isolate the queue between tests (FK order: queue → participation → session → sp).
		await prisma.samlBackchannelLogout.deleteMany();
		await prisma.samlSpParticipation.deleteMany();
		await prisma.samlSsoSession.deleteMany();
		await prisma.spConnection.deleteMany();
	});

	let spSeq = 0;
	async function makeSp(sloSoapUrl: string | null, active = true) {
		spSeq += 1;
		return prisma.spConnection.create({
			data: {
				name: `SP-${spSeq}`,
				spEntityId: `https://sp-${spSeq}-${randomUUID()}.example.com`,
				acsUrl: 'https://sp.example.com/acs',
				spCertificate: 'PEM',
				sloSoapUrl,
				active,
			},
		});
	}

	async function makeSession(username = 'user') {
		return prisma.samlSsoSession.create({
			data: { username, expiresAt: new Date(Date.now() + 3_600_000) },
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

	function events(): string[] {
		return recordSafe.mock.calls.map((c) => (c[0] as { event: string }).event);
	}

	it('BC-PROP-SUCCESS: a healthy SP → succeeded, attempts=1, SP degraded indicator + audit + notifier', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');

		deliver.mockResolvedValue({ outcome: 'succeeded' });
		const tried = await propagation.processDue();
		expect(tried).toBe(1);

		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('succeeded');
		expect(row.attempts).toBe(1);
		expect(row.nextRetryAt).toBeNull();
		expect(row.lastError).toBeNull();

		const spRow = await prisma.spConnection.findUniqueOrThrow({ where: { id: sp.id } });
		expect(spRow.lastBackchannelLogoutStatus).toBe('succeeded');
		expect(spRow.lastBackchannelLogoutAt).not.toBeNull();

		expect(events()).toEqual(
			expect.arrayContaining(['saml_backchannel_logout_sent', 'saml_backchannel_logout_succeeded']),
		);
		expect(notifier.onSent).toHaveBeenCalledTimes(1);
		expect(notifier.onSucceeded).toHaveBeenCalledTimes(1);
	});

	it('BC-PROP-SKEW: SAML_CLOCK_SKEW_SECONDS threads into the SOAP verifier options (§5.C)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');

		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await propagation.processDue();
		expect(deliver).toHaveBeenCalledTimes(1);
		expect((deliver.mock.calls[0][0] as { clockSkewSeconds: number }).clockSkewSeconds).toBe(99);
	});

	it('BC-PROP-PARTIAL: a PartialLogout response → partial outcome, distinct from success/failure', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');

		deliver.mockResolvedValue({ outcome: 'partial', reason: 'partial_logout' });
		await propagation.processDue();

		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('partial');
		const spRow = await prisma.spConnection.findUniqueOrThrow({ where: { id: sp.id } });
		expect(spRow.lastBackchannelLogoutStatus).toBe('partial');
		expect(events()).toContain('saml_backchannel_logout_partial');
		expect(notifier.onSucceeded).toHaveBeenCalledTimes(1);
	});

	it('BC-PROP-03: a failing SP drops to failed with exponential backoff, then given_up at maxRetries', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });

		const rowId = (
			await prisma.samlBackchannelLogout.findFirstOrThrow({ where: { ssoSessionId: session.id } })
		).id;
		const past = () =>
			prisma.samlBackchannelLogout.update({
				where: { id: rowId },
				data: { nextRetryAt: new Date(0) },
			});

		// attempt 1 → failed, attempts=1, backoff ~ base * 2^0
		await propagation.processDue();
		let row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(1);
		expect(row.lastError).toBe('network');
		const backoff1 = row.nextRetryAt!.getTime();

		// attempt 2 → failed, attempts=2, backoff ~ base * 2^1 (strictly larger than attempt 1)
		await past();
		await propagation.processDue();
		row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(2);
		expect(row.nextRetryAt!.getTime()).toBeGreaterThan(backoff1);

		// attempt 3 → attempts=3 > maxRetries(2) → given_up
		await past();
		await propagation.processDue();
		row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.status).toBe('given_up');
		expect(row.attempts).toBe(3);
		expect(row.nextRetryAt).toBeNull();

		const spRow = await prisma.spConnection.findUniqueOrThrow({ where: { id: sp.id } });
		expect(spRow.lastBackchannelLogoutStatus).toBe('given_up');
		expect(events()).toEqual(
			expect.arrayContaining([
				'saml_backchannel_logout_failed',
				'saml_backchannel_logout_given_up',
			]),
		);
		expect(notifier.onFailed).toHaveBeenCalled();
		expect(notifier.onGivenUp).toHaveBeenCalledTimes(1);
	});

	it('BC-PROP-RESEND-ATTEMPTS: operator resend resets attempts so retries are fresh (§5.B2)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });

		const rowId = (
			await prisma.samlBackchannelLogout.findFirstOrThrow({ where: { ssoSessionId: session.id } })
		).id;
		const past = () =>
			prisma.samlBackchannelLogout.update({
				where: { id: rowId },
				data: { nextRetryAt: new Date(0) },
			});

		// drive to given_up (attempts 3 > maxRetries 2)
		await propagation.processDue();
		await past();
		await propagation.processDue();
		await past();
		await propagation.processDue();
		let row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.status).toBe('given_up');
		expect(row.attempts).toBe(3);

		// operator resend → the next delivery succeeds; attempts must be reset (final attempts === 1, not 4)
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await propagation.resend(session.id, sp.id);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await propagation.processDue();
		row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.status).toBe('succeeded');
		expect(row.attempts).toBe(1);
	});

	it('BC-PROP-PRUNE-PARTIAL: partial rows are terminal and get pruned (§5.B2)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'partial', reason: 'partial_logout' });
		await propagation.processDue();
		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('partial');

		// prune with a now far past the retention cutoff → the partial row must be removed
		const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
		const pruned = await propagation.prune(future);
		expect(pruned).toBeGreaterThanOrEqual(1);
		expect(await prisma.samlBackchannelLogout.findFirst({ where: { id: row.id } })).toBeNull();
	});

	it('BC-PROP-A: the requestId is stable and reused across retries (idempotent delivery)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });

		const rowId = (
			await prisma.samlBackchannelLogout.findFirstOrThrow({ where: { ssoSessionId: session.id } })
		).id;

		await propagation.processDue();
		await prisma.samlBackchannelLogout.update({
			where: { id: rowId },
			data: { nextRetryAt: new Date(0) },
		});
		await propagation.processDue();

		const firstReqId = (deliver.mock.calls[0][0] as { requestId: string }).requestId;
		const secondReqId = (deliver.mock.calls[1][0] as { requestId: string }).requestId;
		expect(firstReqId).toBe(secondReqId);
		const row = await prisma.samlBackchannelLogout.findUniqueOrThrow({ where: { id: rowId } });
		expect(row.requestId).toBe(firstReqId);
	});

	it('BC-PROP-04: with the scheduler off, a failed row simply stays failed until processed again', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'timeout' });
		await propagation.processDue();

		// nextRetryAt is in the future → a same-instant processDue does not pick it up again
		const tried = await propagation.processDue();
		expect(tried).toBe(0);
		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(1);
	});

	it('BC-PROP-CONCURRENCY: processDue is bounded by SAML_BACKCHANNEL_LOGOUT_CONCURRENCY per pass', async () => {
		const session = await makeSession();
		for (let i = 0; i < 3; i += 1) {
			const sp = await makeSp('https://sp.example.com/slo/soap');
			await participate(session.id, sp.id);
		}
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'succeeded' });

		const tried = await propagation.processDue();
		expect(tried).toBe(2); // CONCURRENCY=2, even though 3 rows are due
		expect(deliver).toHaveBeenCalledTimes(2);
	});

	it('BC-PROP-INFLIGHT: the global in-flight cap blocks new deliveries until slots free up', async () => {
		// Fill the in-flight pool to MAX_INFLIGHT(5) with claimed rows on distinct SPs.
		const blockerSession = await makeSession('blocker');
		for (let i = 0; i < 5; i += 1) {
			const sp = await makeSp('https://sp.example.com/slo/soap');
			await prisma.samlBackchannelLogout.create({
				data: {
					ssoSessionId: blockerSession.id,
					spConnectionId: sp.id,
					sessionIndex: `_idx-${sp.id}`,
					nameId: 'user@example.com',
					nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
					reason: 'admin_action',
					status: 'in_flight',
					requestId: `_r-${sp.id}`,
				},
			});
		}
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockResolvedValue({ outcome: 'succeeded' });

		const tried = await propagation.processDue();
		expect(tried).toBe(0);
		expect(deliver).not.toHaveBeenCalled();
		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('pending');
	});

	it('BC-PROP-CLAIM: concurrent processDue passes never double-deliver the same row (atomic claim)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		deliver.mockImplementation(
			() => new Promise((r) => setTimeout(() => r({ outcome: 'succeeded' }), 20)),
		);

		await Promise.all([propagation.processDue(), propagation.processDue()]);
		expect(deliver).toHaveBeenCalledTimes(1);
		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('succeeded');
		expect(row.attempts).toBe(1);
	});

	it('BC-PROP-RESEND: an operator resend moves a given_up row back to pending and it can succeed', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		await prisma.samlBackchannelLogout.updateMany({
			where: { ssoSessionId: session.id },
			data: { status: 'given_up', attempts: 3, nextRetryAt: null },
		});

		await propagation.resend(session.id, sp.id);
		let row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('pending');

		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await propagation.processDue();
		row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('succeeded');
	});

	it('BC-PROP-02: an SP without a SOAP endpoint → skipped_no_endpoint (no retry), session still terminated', async () => {
		const sp = await makeSp(null);
		const session = await makeSession();
		await participate(session.id, sp.id);
		const result = await sessions.terminate(session.id, 'admin_action', 'admin-1');
		expect(result.found).toBe(true);

		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('skipped_no_endpoint');
		expect(row.requestId).toBeNull();
		// skipped rows are never picked up for delivery
		const tried = await propagation.processDue();
		expect(tried).toBe(0);
		expect(deliver).not.toHaveBeenCalled();
		expect(events()).toContain('saml_backchannel_logout_skipped');

		const terminated = await prisma.samlSsoSession.findUniqueOrThrow({ where: { id: session.id } });
		expect(terminated.status).toBe('terminated');
	});

	it('an inactive SP is neither delivered to nor recorded as skipped', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap', false);
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		const rows = await prisma.samlBackchannelLogout.findMany({
			where: { ssoSessionId: session.id },
		});
		expect(rows).toHaveLength(0);
	});

	it('BC-PROP-DEDUP: re-terminating an already-handled session never enqueues a duplicate row', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		await sessions.terminate(session.id, 'admin_action', 'admin-1');
		// mark resolved, then re-terminate — the upsert must leave the existing row untouched
		await prisma.samlBackchannelLogout.updateMany({
			where: { ssoSessionId: session.id },
			data: { status: 'succeeded' },
		});
		await propagation.propagateLogout({ ssoSessionId: session.id, reason: 'user_logout' });
		const rows = await prisma.samlBackchannelLogout.findMany({
			where: { ssoSessionId: session.id },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('succeeded'); // not reset to pending
	});

	it('BC-PROP-06: terminate() is never blocked by a hanging SP delivery', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, sp.id);
		deliver.mockImplementation(() => new Promise<SoapDeliveryResult>(() => {})); // never resolves

		const start = Date.now();
		const result = await sessions.terminate(session.id, 'admin_action', 'admin-1');
		expect(Date.now() - start).toBeLessThan(2_000);
		expect(result.found).toBe(true);
		const terminated = await prisma.samlSsoSession.findUniqueOrThrow({ where: { id: session.id } });
		expect(terminated.status).toBe('terminated');
	});

	it('BC-PROP-07: persisted pending rows survive a "restart" — a fresh processDue picks them up', async () => {
		// Insert a pending row directly (no terminate) to simulate a row left by a previous process.
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await prisma.samlBackchannelLogout.create({
			data: {
				ssoSessionId: session.id,
				spConnectionId: sp.id,
				sessionIndex: '_idx',
				nameId: 'user@example.com',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				reason: 'sp_logout',
				status: 'pending',
				requestId: '_persisted-req',
				nextRetryAt: new Date(),
			},
		});
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await propagation.processDue();
		const row = await prisma.samlBackchannelLogout.findFirstOrThrow({
			where: { ssoSessionId: session.id },
		});
		expect(row.status).toBe('succeeded');
		// the persisted requestId is reused on the wire (dedup by the SP)
		expect((deliver.mock.calls[0][0] as { requestId: string }).requestId).toBe('_persisted-req');
	});

	it('BC-SPINIT: the excluded initiator SP is not propagated to; the others are', async () => {
		const initiator = await makeSp('https://init.example.com/slo/soap');
		const other = await makeSp('https://other.example.com/slo/soap');
		const session = await makeSession();
		await participate(session.id, initiator.id);
		await participate(session.id, other.id);

		await sessions.terminate(session.id, 'sp_logout', undefined, {
			excludeSpConnectionId: initiator.id,
		});

		const rows = await prisma.samlBackchannelLogout.findMany({
			where: { ssoSessionId: session.id },
		});
		expect(rows.map((r) => r.spConnectionId)).toEqual([other.id]);
	});

	it('BC-PROP-PRUNE: prune removes resolved rows past the retention window but keeps pending', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		const base = {
			ssoSessionId: session.id,
			spConnectionId: sp.id,
			sessionIndex: '_idx',
			nameId: 'user@example.com',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			reason: 'admin_action',
		};
		// distinct sessions to satisfy the (session, sp) unique constraint
		const s2 = await makeSession('s2');
		const s3 = await makeSession('s3');
		await prisma.samlBackchannelLogout.create({ data: { ...base, status: 'succeeded' } });
		await prisma.samlBackchannelLogout.create({
			data: { ...base, ssoSessionId: s2.id, status: 'given_up' },
		});
		await prisma.samlBackchannelLogout.create({
			data: { ...base, ssoSessionId: s3.id, status: 'pending', nextRetryAt: new Date() },
		});

		// A "now" far in the future puts all rows past the retention window.
		const future = new Date(Date.now() + 30 * 86_400_000);
		const removed = await propagation.prune(future);
		expect(removed).toBe(2); // succeeded + given_up pruned

		const remaining = await prisma.samlBackchannelLogout.findMany();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].status).toBe('pending');
	});

	it('BC-PROP-PRUNE-RECENT: prune keeps recently-resolved rows', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		const session = await makeSession();
		await prisma.samlBackchannelLogout.create({
			data: {
				ssoSessionId: session.id,
				spConnectionId: sp.id,
				sessionIndex: '_idx',
				nameId: 'user@example.com',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				reason: 'admin_action',
				status: 'succeeded',
			},
		});
		const removed = await propagation.prune(new Date());
		expect(removed).toBe(0);
	});

	// --- "Test back-channel SLO" probe (item S) — validation only, never enqueues, never throws --------

	it('BC-PROBE-OK: a reachable SP that accepts the signed probe → { ok: true }, no queue row', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		const result = await propagation.probe(sp.id);
		expect(result.ok).toBe(true);
		expect(deliver).toHaveBeenCalledTimes(1);
		// the probe must never persist a delivery row
		expect(await prisma.samlBackchannelLogout.count()).toBe(0);
	});

	it('BC-PROBE-SKEW: the probe delivery also honours SAML_CLOCK_SKEW_SECONDS (§5.C)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await propagation.probe(sp.id);
		expect((deliver.mock.calls[0][0] as { clockSkewSeconds: number }).clockSkewSeconds).toBe(99);
	});

	it('BC-PROBE-PARTIAL: a PartialLogout probe response still counts as reachable (ok:true)', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		deliver.mockResolvedValue({ outcome: 'partial', reason: 'partial_logout' });
		const result = await propagation.probe(sp.id);
		expect(result.ok).toBe(true);
	});

	it('BC-PROBE-FAIL: an unreachable SP → { ok: false, reason }', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });
		const result = await propagation.probe(sp.id);
		expect(result).toEqual({ ok: false, reason: 'network' });
	});

	it('BC-PROBE-NOENDPOINT: an SP without a SOAP endpoint → { ok:false, no_soap_endpoint }, no delivery', async () => {
		const sp = await makeSp(null);
		const result = await propagation.probe(sp.id);
		expect(result).toEqual({ ok: false, reason: 'no_soap_endpoint' });
		expect(deliver).not.toHaveBeenCalled();
	});

	it('BC-PROBE-MISSING: an unknown SP id → { ok:false }, never throws', async () => {
		const result = await propagation.probe('cnonexistent000000000000000');
		expect(result.ok).toBe(false);
		expect(deliver).not.toHaveBeenCalled();
	});

	it('BC-PROBE-NOTHROW: a dispatcher that throws is caught → { ok:false, reason }', async () => {
		const sp = await makeSp('https://sp.example.com/slo/soap');
		deliver.mockRejectedValue(new Error('boom'));
		const result = await propagation.probe(sp.id);
		expect(result.ok).toBe(false);
		expect(result.reason).toBeDefined();
	});
});
