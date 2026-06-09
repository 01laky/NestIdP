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
		const bcFindMany = jest.fn().mockResolvedValue([]);
		const userFindMany = jest.fn().mockResolvedValue([
			{
				id: 'u1',
				apiConnectionId: 'conn-1',
				apiConnection: { name: 'HR', isLocalDirectory: false },
			},
		]);
		const { service } = makeService({
			samlSsoSession: { count, findMany },
			samlBackchannelLogout: { findMany: bcFindMany },
			user: { findMany: userFindMany },
		});
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
		// Per-SP back-channel state is fetched for the page's sessions (Prompt 36, item N).
		expect(bcFindMany.mock.calls[0][0].where).toEqual({ ssoSessionId: { in: ['s1'] } });
		// Per-user source resolution (Prompt 37): sourceLabel is attached from the user's connection.
		expect(res.items[0].sourceApiConnectionId).toBe('conn-1');
		expect(res.items[0].sourceLabel).toBe('HR');
	});

	it('MAS-SESS-FILTER: apiConnectionId filter scopes sessions to that source’s users', async () => {
		const count = jest.fn().mockResolvedValue(0);
		const findMany = jest.fn().mockResolvedValue([]);
		const bcFindMany = jest.fn().mockResolvedValue([]);
		// First user.findMany resolves the connection's user ids; second resolves page sources (none).
		const userFindMany = jest
			.fn()
			.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
			.mockResolvedValueOnce([]);
		const { service } = makeService({
			samlSsoSession: { count, findMany },
			samlBackchannelLogout: { findMany: bcFindMany },
			user: { findMany: userFindMany },
		});

		await service.listForAdmin({ status: 'active', apiConnectionId: 'conn-7' });

		expect(userFindMany.mock.calls[0][0].where).toEqual({ apiConnectionId: 'conn-7' });
		expect(findMany.mock.calls[0][0].where.userId).toEqual({ in: ['u1', 'u2'] });
	});

	it('BC-ADMIN-02: terminateBulk reports per-id outcomes (terminated / already / not-found)', async () => {
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce({ status: 'active' })
			.mockResolvedValueOnce({ status: 'terminated' })
			.mockResolvedValueOnce(null);
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findUnique, update } });
		const res = await service.terminateBulk(['a', 'b', 'c'], 'admin-1');
		expect(res.results).toEqual([
			{ id: 'a', outcome: 'terminated' },
			{ id: 'b', outcome: 'already_terminated' },
			{ id: 'c', outcome: 'not_found' },
		]);
		expect(res.terminatedCount).toBe(1);
	});

	it('BC-ADMIN-L: terminateAllActive terminates every active session', async () => {
		const findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
		const findUnique = jest.fn().mockResolvedValue({ status: 'active' });
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findMany, findUnique, update } });
		const count = await service.terminateAllActive('admin-1');
		expect(count).toBe(2);
		expect(findMany).toHaveBeenCalledWith({
			where: { status: 'active' },
			select: { id: true },
		});
	});

	it('BC-ADMIN-empty: terminateBulk with an empty id list is a no-op', async () => {
		const findUnique = jest.fn();
		const { service } = makeService({ samlSsoSession: { findUnique, update: jest.fn() } });
		const res = await service.terminateBulk([], 'admin-1');
		expect(res).toEqual({ results: [], terminatedCount: 0 });
		expect(findUnique).not.toHaveBeenCalled();
	});

	it('BC-ADMIN-dupes: terminateBulk de-duplicates outcomes per id (already-terminated on the second pass)', async () => {
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce({ status: 'active' })
			.mockResolvedValueOnce({ status: 'terminated' });
		const update = jest.fn().mockResolvedValue({});
		const { service } = makeService({ samlSsoSession: { findUnique, update } });
		const res = await service.terminateBulk(['a', 'a'], 'admin-1');
		expect(res.results).toEqual([
			{ id: 'a', outcome: 'terminated' },
			{ id: 'a', outcome: 'already_terminated' },
		]);
		expect(res.terminatedCount).toBe(1);
	});

	it('BC-ADMIN-L0: terminateAllActive returns 0 when there are no active sessions', async () => {
		const findMany = jest.fn().mockResolvedValue([]);
		const { service } = makeService({
			samlSsoSession: { findMany, findUnique: jest.fn(), update: jest.fn() },
		});
		expect(await service.terminateAllActive('admin-1')).toBe(0);
	});

	it('BC-PROP fan-out: terminate() invokes the propagation port with the exclude option', async () => {
		const findUnique = jest.fn().mockResolvedValue({ status: 'active' });
		const update = jest.fn().mockResolvedValue({});
		const audit = { recordSafe: jest.fn() } as unknown as AuditPersistenceService;
		const propagation = { propagateLogout: jest.fn().mockResolvedValue(undefined) };
		const service = new SamlSsoSessionService(
			{ samlSsoSession: { findUnique, update } } as never,
			audit,
			propagation,
		);
		await service.terminate('sess-1', 'sp_logout', undefined, { excludeSpConnectionId: 'sp-init' });
		expect(propagation.propagateLogout).toHaveBeenCalledWith({
			ssoSessionId: 'sess-1',
			reason: 'sp_logout',
			excludeSpConnectionId: 'sp-init',
		});
	});
});
