import { SamlSsoSessionService } from '@api/saml-sessions/services/saml-sso-session.service';
import type { PrismaService } from '@api/prisma/services/prisma.service';
import type { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';

function makeService(prisma: Record<string, unknown>) {
	const audit = { recordSafe: jest.fn() } as unknown as AuditPersistenceService;
	const service = new SamlSsoSessionService(prisma as unknown as PrismaService, audit);
	return { service, audit };
}

describe('saml-sso-session.service', () => {
	it('API-SESS-REG-01: create() inserts a session and audits start', async () => {
		const create = jest.fn().mockResolvedValue({ id: 'sso1' });
		const { service, audit } = makeService({ samlSsoSession: { create } });
		const result = await service.create({
			userId: 'u1',
			username: 'alice',
			expiresAt: new Date(Date.now() + 1000),
			loginIp: '1.2.3.4',
			userAgent: 'jest',
		});
		expect(result.id).toBe('sso1');
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ userId: 'u1', username: 'alice', loginIp: '1.2.3.4' }),
			}),
		);
		expect((audit.recordSafe as jest.Mock).mock.calls[0][0].event).toBe('saml_sso_session_started');
	});

	it('API-SESS-REG-02: createParticipation() persists sessionIndex + NameID', async () => {
		const create = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSpParticipation: { create } });
		await service.createParticipation({
			ssoSessionId: 'sso1',
			spConnectionId: 'sp1',
			sessionIndex: '_si',
			nameId: 'alice@e.com',
			nameIdFormat: 'fmt',
		});
		expect(create).toHaveBeenCalledWith({
			data: {
				ssoSessionId: 'sso1',
				spConnectionId: 'sp1',
				sessionIndex: '_si',
				nameId: 'alice@e.com',
				nameIdFormat: 'fmt',
			},
		});
	});

	it('API-SESS-REVOKE-01: isActive true only for active + unexpired', async () => {
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce({ status: 'active', expiresAt: new Date(Date.now() + 10000) })
			.mockResolvedValueOnce({ status: 'terminated', expiresAt: new Date(Date.now() + 10000) })
			.mockResolvedValueOnce({ status: 'active', expiresAt: new Date(Date.now() - 10000) });
		const { service } = makeService({ samlSsoSession: { findUnique } });
		expect(await service.isActive('a')).toBe(true);
		expect(await service.isActive('b')).toBe(false);
		expect(await service.isActive('c')).toBe(false);
		expect(await service.isActive(undefined)).toBe(false);
	});

	it('terminate() is idempotent and reports not-found', async () => {
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce({ status: 'active' })
			.mockResolvedValueOnce({ status: 'terminated' })
			.mockResolvedValueOnce(null);
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findUnique, update } });
		expect(await service.terminate('a', 'admin_action', 'admin1')).toEqual({
			alreadyTerminated: false,
			found: true,
		});
		expect(await service.terminate('a', 'admin_action')).toEqual({
			alreadyTerminated: true,
			found: true,
		});
		expect(await service.terminate('missing', 'admin_action')).toEqual({
			alreadyTerminated: false,
			found: false,
		});
		expect(update).toHaveBeenCalledTimes(1);
	});

	it('API-ADM-SESS-07/H5: terminateAllForUser terminates every active session', async () => {
		const findMany = jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
		const findUnique = jest.fn().mockResolvedValue({ status: 'active' });
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findMany, findUnique, update } });
		const count = await service.terminateAllForUser('u1', 'user_deactivated');
		expect(count).toBe(2);
		expect(update).toHaveBeenCalledTimes(2);
	});

	it('API-SLO-MATCH-01: findMatchingForLogout matches by spConnectionId + sessionIndex', async () => {
		const findFirst = jest.fn().mockResolvedValue({ ssoSessionId: 'sso9' });
		const { service } = makeService({ samlSpParticipation: { findFirst } });
		const match = await service.findMatchingForLogout({
			spConnectionId: 'sp1',
			nameId: 'a@e.com',
			sessionIndexes: ['_si'],
		});
		expect(match).toEqual({ ssoSessionId: 'sso9' });
		expect(findFirst.mock.calls[0][0].where.sessionIndex).toEqual({ in: ['_si'] });
	});

	it('API-SLO-MATCH-02: matches by NameID when no SessionIndex provided', async () => {
		const findFirst = jest.fn().mockResolvedValue(null);
		const { service } = makeService({ samlSpParticipation: { findFirst } });
		await service.findMatchingForLogout({
			spConnectionId: 'sp1',
			nameId: 'a@e.com',
			sessionIndexes: [],
		});
		expect(findFirst.mock.calls[0][0].where.sessionIndex).toBeUndefined();
		expect(findFirst.mock.calls[0][0].where.nameId).toBe('a@e.com');
	});

	it('H1: recordLogoutRequestId inserts the request id', async () => {
		const create = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlLogoutRequestLog: { create } });
		await service.recordLogoutRequestId('_lr', 'sp1');
		expect(create).toHaveBeenCalledWith({ data: { requestId: '_lr', spConnectionId: 'sp1' } });
	});

	it('H6: create truncates a long user-agent to 512 chars', async () => {
		const create = jest.fn().mockResolvedValue({ id: 'sso1' });
		const { service } = makeService({ samlSpParticipation: {}, samlSsoSession: { create } });
		await service.create({
			userId: 'u1',
			username: 'alice',
			expiresAt: new Date(),
			userAgent: 'x'.repeat(1000),
		});
		expect((create.mock.calls[0][0].data.userAgent as string).length).toBe(512);
	});

	it('H6: create with null userId is allowed', async () => {
		const create = jest.fn().mockResolvedValue({ id: 'sso1' });
		const { service } = makeService({ samlSsoSession: { create } });
		await service.create({ userId: null, username: 'anon', expiresAt: new Date() });
		expect(create.mock.calls[0][0].data.userId).toBeNull();
	});

	it('H9: touch updates lastSeenAt/lastSeenIp for active session and never throws', async () => {
		const updateMany = jest.fn().mockResolvedValue({ count: 1 });
		const { service } = makeService({ samlSsoSession: { updateMany } });
		await service.touch('sso1', '9.9.9.9');
		expect(updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'sso1', status: 'active' } }),
		);
		// missing sid is a no-op
		await service.touch(undefined, '9.9.9.9');
		expect(updateMany).toHaveBeenCalledTimes(1);
	});

	it('H9: touch swallows DB errors (best-effort)', async () => {
		const updateMany = jest.fn().mockRejectedValue(new Error('db down'));
		const { service } = makeService({ samlSsoSession: { updateMany } });
		await expect(service.touch('sso1', '9.9.9.9')).resolves.toBeUndefined();
	});

	it('terminateAllForUser counts only newly-terminated sessions', async () => {
		const findMany = jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce({ status: 'active' })
			.mockResolvedValueOnce({ status: 'terminated' })
			.mockResolvedValueOnce({ status: 'active' });
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findMany, findUnique, update } });
		const count = await service.terminateAllForUser('u1', 'admin_action', 'adm1');
		expect(count).toBe(2);
	});

	it('findMatchingForLogout returns null when nothing matches', async () => {
		const findFirst = jest.fn().mockResolvedValue(null);
		const { service } = makeService({ samlSpParticipation: { findFirst } });
		expect(
			await service.findMatchingForLogout({
				spConnectionId: 'sp1',
				nameId: 'x',
				sessionIndexes: [],
			}),
		).toBeNull();
	});

	it('API-ADM-SESS-03: listForAdmin computes skip/take from page + pageSize', async () => {
		const count = jest.fn().mockResolvedValue(25);
		const findMany = jest.fn().mockResolvedValue([]);
		const { service } = makeService({ samlSsoSession: { count, findMany } });
		await service.listForAdmin({ status: 'all', page: 3, pageSize: 5 });
		const args = findMany.mock.calls[0][0];
		expect(args.skip).toBe(10);
		expect(args.take).toBe(5);
		expect(args.where.status).toBeUndefined(); // 'all' → no status filter
	});

	it("API-ADM-SESS-03b: default page/pageSize when omitted (status 'active')", async () => {
		const count = jest.fn().mockResolvedValue(0);
		const findMany = jest.fn().mockResolvedValue([]);
		const { service } = makeService({ samlSsoSession: { count, findMany } });
		await service.listForAdmin({});
		const args = findMany.mock.calls[0][0];
		expect(args.skip).toBe(0);
		expect(args.take).toBe(10);
		expect(args.where.status).toBe('active');
	});

	it('API-ADM-SESS-01/02: listForAdmin applies status + SP + search filters', async () => {
		const count = jest.fn().mockResolvedValue(1);
		const findMany = jest.fn().mockResolvedValue([
			{
				id: 's1',
				userId: 'u1',
				username: 'alice',
				createdAt: new Date(),
				lastSeenAt: new Date(),
				expiresAt: new Date(),
				loginIp: null,
				userAgent: null,
				lastSeenIp: null,
				status: 'active',
				terminatedAt: null,
				terminatedReason: null,
				participations: [],
			},
		]);
		const { service } = makeService({ samlSsoSession: { count, findMany } });
		const res = await service.listForAdmin({
			status: 'terminated',
			spConnectionId: 'sp1',
			q: 'ali',
		});
		expect(res.total).toBe(1);
		expect(res.items[0].username).toBe('alice');
		const where = findMany.mock.calls[0][0].where;
		expect(where.status).toBe('terminated');
		expect(where.participations).toEqual({ some: { spConnectionId: 'sp1' } });
		expect(where.OR).toBeDefined();
	});
});
