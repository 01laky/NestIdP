import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LOGOUT_PROPAGATION_PORT } from '@nestidp/shared';
import { BackchannelLogoutModule } from '@api/saml/backchannel-logout.module';
import { LogoutPropagationService } from '@api/saml/services/logout-propagation.service';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { SamlSsoSessionService } from '@api/saml-sessions/services/saml-sso-session.service';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(60_000);

/**
 * Back-channel SLO DI + fan-out (Prompt 36). Proves the @Global wiring resolves without a cycle and that
 * terminating a session enqueues a per-SP delivery (pending for SPs with a SOAP endpoint,
 * skipped_no_endpoint otherwise). First pass + scheduler disabled so enqueued rows stay observable.
 */
describe('back-channel logout integration (SQLite)', () => {
	let moduleRef: TestingModule;
	let prisma: PrismaService;
	let sessions: SamlSsoSessionService;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-bclo-${randomUUID()}.db`);
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
							// Keep deliveries from firing so we can observe the enqueued rows deterministically.
							SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS: 0,
							SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS: 0,
						}),
					],
				}),
				PrismaModule,
				BackchannelLogoutModule,
			],
		})
			.overrideProvider(PrismaService)
			.useValue(prismaService)
			.compile();

		prisma = moduleRef.get(PrismaService);
		sessions = moduleRef.get(SamlSsoSessionService);
		await moduleRef.init();
	});

	afterAll(async () => {
		await moduleRef.close();
	});

	async function makeSp(name: string, sloSoapUrl: string | null) {
		return prisma.spConnection.create({
			data: {
				name,
				spEntityId: `https://sp-${randomUUID()}.example.com`,
				acsUrl: 'https://sp.example.com/acs',
				sloSoapUrl,
				active: true,
			},
		});
	}

	it('BC-DI-01: the @Global LOGOUT_PROPAGATION_PORT resolves to the real LogoutPropagationService (no cycle)', () => {
		expect(moduleRef.get(LOGOUT_PROPAGATION_PORT)).toBeInstanceOf(LogoutPropagationService);
	});

	it('BC-PROP-01: terminating a session enqueues a delivery per SP (pending) and skips SPs without SOAP', async () => {
		const spSoap = await makeSp('SP-soap', 'https://sp-soap.example.com/slo/soap');
		const spNoSoap = await makeSp('SP-nosoap', null);
		const session = await prisma.samlSsoSession.create({
			data: { username: 'bob', expiresAt: new Date(Date.now() + 3_600_000) },
		});
		for (const sp of [spSoap, spNoSoap]) {
			await prisma.samlSpParticipation.create({
				data: {
					ssoSessionId: session.id,
					spConnectionId: sp.id,
					sessionIndex: `_idx-${sp.id}`,
					nameId: 'bob@example.com',
					nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				},
			});
		}

		const result = await sessions.terminate(session.id, 'admin_action', 'admin-1');
		expect(result.found).toBe(true);

		const rows = await prisma.samlBackchannelLogout.findMany({
			where: { ssoSessionId: session.id },
		});
		const byStatus = new Map(rows.map((r) => [r.spConnectionId, r.status]));
		expect(byStatus.get(spSoap.id)).toBe('pending');
		expect(byStatus.get(spNoSoap.id)).toBe('skipped_no_endpoint');
	});

	it('BC-PROP-EXCLUDE: the excluded initiator SP is not enqueued', async () => {
		const spA = await makeSp('SP-A', 'https://sp-a.example.com/slo/soap');
		const spB = await makeSp('SP-B', 'https://sp-b.example.com/slo/soap');
		const session = await prisma.samlSsoSession.create({
			data: { username: 'carol', expiresAt: new Date(Date.now() + 3_600_000) },
		});
		for (const sp of [spA, spB]) {
			await prisma.samlSpParticipation.create({
				data: {
					ssoSessionId: session.id,
					spConnectionId: sp.id,
					sessionIndex: `_idx-${sp.id}`,
					nameId: 'carol@example.com',
					nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				},
			});
		}

		await sessions.terminate(session.id, 'sp_logout', undefined, { excludeSpConnectionId: spA.id });

		const rows = await prisma.samlBackchannelLogout.findMany({
			where: { ssoSessionId: session.id },
		});
		expect(rows.map((r) => r.spConnectionId)).toEqual([spB.id]);
	});
});
