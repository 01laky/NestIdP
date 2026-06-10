import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SamlSsoSessionService } from '@api/saml-sessions/services/saml-sso-session.service';
import { PrismaService } from '@api/prisma/services/prisma.service';
import type { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(120_000);

/**
 * listForAdmin `q` search against real SQLite (Prompt 38 §5.C/§B7). Prisma `contains` translated to a
 * `LIKE` with no `ESCAPE` clause, so a literal `%`/`_` in the search term acted as a wildcard and
 * matched everything. The escaped raw-LIKE path (mirroring IdentityRepository.listUsersWithSearch)
 * must treat them literally and stay case-insensitive.
 */
describe('saml-sso-session.service listForAdmin search (SQLite)', () => {
	let prisma: PrismaService;
	let service: SamlSsoSessionService;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-sess-search-${randomUUID()}.db`);
		const databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		const audit = { recordSafe: jest.fn() } as unknown as AuditPersistenceService;
		service = new SamlSsoSessionService(prisma, audit);

		const expiresAt = new Date(Date.now() + 3_600_000);
		await prisma.samlSsoSession.create({ data: { username: 'alice', expiresAt } });
		await prisma.samlSsoSession.create({ data: { username: '50%off', expiresAt } });
		await prisma.samlSsoSession.create({ data: { username: 'bob_smith', expiresAt } });
		const carol = await prisma.samlSsoSession.create({ data: { username: 'carol', expiresAt } });
		const sp = await prisma.spConnection.create({
			data: {
				name: 'SP',
				spEntityId: 'https://sp.example.com',
				acsUrl: 'https://sp.example.com/acs',
			},
		});
		await prisma.samlSpParticipation.create({
			data: {
				ssoSessionId: carol.id,
				spConnectionId: sp.id,
				sessionIndex: '_idx',
				nameId: 'carol@example.com',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			},
		});
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	async function usernames(q: string): Promise<string[]> {
		const res = await service.listForAdmin({ status: 'all', q });
		return res.items.map((item) => item.username).sort();
	}

	it('API-ADM-SESS-LIKE-01: a literal "%" term matches only the username containing "%", not everything', async () => {
		expect(await usernames('%')).toEqual(['50%off']);
		expect(await usernames('0%o')).toEqual(['50%off']);
	});

	it('API-ADM-SESS-LIKE-02: a literal "_" term matches only the username containing "_"', async () => {
		expect(await usernames('_')).toEqual(['bob_smith']);
	});

	it('API-ADM-SESS-LIKE-03: search is case-insensitive', async () => {
		expect(await usernames('ALI')).toEqual(['alice']);
	});

	it('API-ADM-SESS-LIKE-04: search also matches a participation NameID', async () => {
		expect(await usernames('carol@example')).toEqual(['carol']);
	});

	it('API-ADM-SESS-LIKE-05: a non-matching term returns an empty page', async () => {
		expect(await usernames('zzz-no-match')).toEqual([]);
	});
});
