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
import {
	ADMIN_CSRF_HEADER_NAME,
	API_CONNECTIONS_API_PATH,
	AUTH_API_PATH,
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_USERS_API_PATH,
	SYNC_API_PATH,
} from '@nestidp/shared';
import { IdentityOrigin } from '@prisma/client';
import { AdminModule } from '@api/admin/admin.module';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';
import { AuthModule } from '@api/auth/auth.module';
import { encrypt } from '@api/encryption/utils/encryption.util';
import { ensureLocalDirectoryConnection } from '@api/identity/utils/local-directory.util';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestIdpSettingsWithSigningKey,
	createTestSamlSession,
	createTestSpConnection,
	createTestUser,
	TEST_ENCRYPTION_KEY,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(90_000);

function mockEmptySyncApi(): jest.SpiedFunction<typeof fetch> {
	return jest.spyOn(global, 'fetch').mockImplementation(
		async () =>
			({
				status: 200,
				json: async () => [],
			}) as Response,
	);
}

describe('Identity manual CRUD (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'identity-manual-admin';
	const manualPassword = 'manual-pass-12';

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

	async function adminAgent() {
		const agent = request.agent(app.getHttpServer() as App);
		const csrf = await loginAgent(agent);
		return { agent, csrf };
	}

	function manualUserBody(overrides: Record<string, unknown> = {}) {
		return {
			username: `manual-${randomUUID().slice(0, 8)}`,
			password: manualPassword,
			confirmPassword: manualPassword,
			active: true,
			...overrides,
		};
	}

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-idn-man-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		const prismaService = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [
						() => ({
							DATABASE_URL: databaseUrl,
							SESSION_SECRET: 'test-session-secret-min-16',
							ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				PrismaModule,
				AdminModule,
				AuthModule,
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
		await ensureLocalDirectoryConnection(prisma, (plain) => encrypt(plain, TEST_ENCRYPTION_KEY));
		await createTestIdpSettingsWithSigningKey(prisma);
	});

	beforeEach(() => {
		app.get(LoginProtectionService).clear();
		app.get(LoginProtectionService).clear();
	});

	afterAll(async () => {
		await app.close();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-IDN-MAN-01: POST manual user → 201 with origin manual', async () => {
		const { agent, csrf } = await adminAgent();
		const res = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'man-user-01' }))
			.expect(201);
		expect(res.body.user.origin).toBe('manual');
		expect(res.body.user.externalId).toMatch(/^manual:user:/);
		expect(res.body.source.kind).toBe('local_directory');
	});

	it('API-IDN-MAN-02: POST without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.post(IDENTITY_USERS_API_PATH)
			.send(manualUserBody())
			.expect(401);
	});

	it('API-IDN-MAN-03: POST without CSRF → 403', async () => {
		const agent = request.agent(app.getHttpServer() as App);
		await loginAgent(agent);
		await agent.post(IDENTITY_USERS_API_PATH).send(manualUserBody()).expect(403);
	});

	it('API-IDN-MAN-04: PATCH synced user → 403 managed_by_sync', async () => {
		const conn = await createTestApiConnection(prisma);
		const synced = await createTestUser(prisma, conn.id, { username: 'synced-patch' });
		const { agent, csrf } = await adminAgent();
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${synced.id}`)
			.set(csrfHeader(csrf))
			.send({ displayName: 'Nope' })
			.expect(403);
	});

	it('API-IDN-MAN-05: DELETE synced user → 403', async () => {
		const conn = await createTestApiConnection(prisma);
		const synced = await createTestUser(prisma, conn.id, { username: 'synced-del' });
		const { agent, csrf } = await adminAgent();
		await agent.delete(`${IDENTITY_USERS_API_PATH}/${synced.id}`).set(csrfHeader(csrf)).expect(403);
	});

	it('API-IDN-MAN-06: duplicate username → 409', async () => {
		const conn = await createTestApiConnection(prisma);
		await createTestUser(prisma, conn.id, { username: 'taken-name' });
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'taken-name' }))
			.expect(409);
	});

	it('API-IDN-MAN-07: POST manual group and role', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: `grp-${randomUUID().slice(0, 6)}` })
			.expect(201);
		expect(group.body.group.origin).toBe('manual');
		const role = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: `role-${randomUUID().slice(0, 6)}` })
			.expect(201);
		expect(role.body.role.origin).toBe('manual');
	});

	it('API-IDN-MAN-08: DELETE group with members → 409', async () => {
		const { agent, csrf } = await adminAgent();
		const groupRes = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'has-members' })
			.expect(201);
		const groupId = groupRes.body.group.id as string;
		const userRes = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ groupIds: [groupId] }))
			.expect(201);
		void userRes;
		await agent.delete(`${IDENTITY_GROUPS_API_PATH}/${groupId}`).set(csrfHeader(csrf)).expect(409);
	});

	it('API-IDN-MAN-09: PATCH manual user updates profile fields', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'patch-me', email: 'old@example.com' }))
			.expect(201);
		const userId = created.body.user.id as string;
		const updated = await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${userId}`)
			.set(csrfHeader(csrf))
			.send({ displayName: 'Patched Name', email: 'new@example.com', active: false })
			.expect(200);
		expect(updated.body.user.displayName).toBe('Patched Name');
		expect(updated.body.user.email).toBe('new@example.com');
		expect(updated.body.user.active).toBe(false);
	});

	it('API-IDN-MAN-10: DELETE manual user → 204 then GET 404', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'delete-me' }))
			.expect(201);
		const userId = created.body.user.id as string;
		await agent.delete(`${IDENTITY_USERS_API_PATH}/${userId}`).set(csrfHeader(csrf)).expect(204);
		await agent.get(`${IDENTITY_USERS_API_PATH}/${userId}`).expect(404);
	});

	it('API-IDN-MAN-11: PATCH manual group renames', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'old-group-name' })
			.expect(201);
		const res = await agent
			.patch(`${IDENTITY_GROUPS_API_PATH}/${group.body.group.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'new-group-name' })
			.expect(200);
		expect(res.body.group.name).toBe('new-group-name');
	});

	it('API-IDN-MAN-12: DELETE manual group without members → 204', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'empty-group' })
			.expect(201);
		await agent
			.delete(`${IDENTITY_GROUPS_API_PATH}/${group.body.group.id}`)
			.set(csrfHeader(csrf))
			.expect(204);
		await agent.get(`${IDENTITY_GROUPS_API_PATH}/${group.body.group.id}`).expect(404);
	});

	it('API-IDN-MAN-13: PATCH synced group → 403 managed_by_sync', async () => {
		const conn = await createTestApiConnection(prisma);
		const synced = await createTestGroup(prisma, conn.id, { name: 'sync-grp-patch' });
		const { agent, csrf } = await adminAgent();
		await agent
			.patch(`${IDENTITY_GROUPS_API_PATH}/${synced.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'nope' })
			.expect(403);
	});

	it('API-IDN-MAN-14: duplicate manual group name in local directory → 409', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'dup-group' })
			.expect(201);
		await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'dup-group' })
			.expect(409);
	});

	it('API-IDN-MAN-15: DELETE role with members → 409; empty role → 204', async () => {
		const { agent, csrf } = await adminAgent();
		const role = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'role-with-member' })
			.expect(201);
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'role-member-user', roleIds: [role.body.role.id] }))
			.expect(201);
		await agent
			.delete(`${IDENTITY_ROLES_API_PATH}/${role.body.role.id}`)
			.set(csrfHeader(csrf))
			.expect(409);
		const emptyRole = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'empty-role' })
			.expect(201);
		await agent
			.delete(`${IDENTITY_ROLES_API_PATH}/${emptyRole.body.role.id}`)
			.set(csrfHeader(csrf))
			.expect(204);
	});

	it('API-IDN-MAN-16: GET never exposes passwordHash', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody())
			.expect(201);
		const detail = await agent
			.get(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}`)
			.expect(200);
		expect(JSON.stringify(detail.body)).not.toContain('passwordHash');
	});

	it('API-IDN-MAN-17: manual user survives sync deactivate and orphan purge', async () => {
		const fetchMock = mockEmptySyncApi();
		const syncConn = await createTestApiConnection(prisma, {
			name: 'HR Sync',
			baseUrl: 'https://hr.example.com',
		});
		const { agent, csrf } = await adminAgent();
		const manual = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'survivor-man' }))
			.expect(201);
		const manualGroup = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'survivor-grp' })
			.expect(201);
		const manualId = manual.body.user.id as string;
		const manualGroupId = manualGroup.body.group.id as string;
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${manualId}`)
			.set(csrfHeader(csrf))
			.send({ groupIds: [manualGroupId] })
			.expect(200);
		await agent
			.post(`${SYNC_API_PATH}/${syncConn.id}`)
			.set(csrfHeader(csrf))
			.send({ dryRun: false })
			.expect(200);
		const still = await prisma.user.findUnique({ where: { id: manualId } });
		expect(still?.active).toBe(true);
		expect(still?.origin).toBe(IdentityOrigin.MANUAL);
		const grpStill = await prisma.group.findUnique({ where: { id: manualGroupId } });
		expect(grpStill).not.toBeNull();
		fetchMock.mockRestore();
	});

	it('API-IDN-MAN-18: POST sync on local directory → 400', async () => {
		const local = await prisma.apiConnection.findFirst({ where: { isLocalDirectory: true } });
		const { agent, csrf } = await adminAgent();
		await agent
			.post(`${SYNC_API_PATH}/${local!.id}`)
			.set(csrfHeader(csrf))
			.send({ dryRun: false })
			.expect(400);
	});

	it('API-IDN-MAN-19 / MAS: multiple syncable connections coexist (Prompt 37 multi-source)', async () => {
		const { agent, csrf } = await adminAgent();
		await createTestApiConnection(prisma, { name: 'First HR' });
		await agent
			.post(API_CONNECTIONS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				name: 'Second HR',
				baseUrl: 'https://hr2.example.com',
				bearerToken: 'token-2',
			})
			.expect(201);
	});

	it('API-IDN-MAN-20: API connections list omits local row', async () => {
		const { agent } = await adminAgent();
		const res = await agent.get(API_CONNECTIONS_API_PATH).expect(200);
		expect(res.body.connections.every((c: { name: string }) => c.name !== 'Local directory')).toBe(
			true,
		);
	});

	it('API-IDN-MAN-21: dashboard apiConnection is syncable when both exist', async () => {
		await createTestApiConnection(prisma, { name: 'Dash HR' });
		const local = await prisma.apiConnection.findFirst({ where: { isLocalDirectory: true } });
		const { agent } = await adminAgent();
		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.apiConnection).toBeDefined();
		expect(res.body.apiConnection.id).not.toBe(local?.id);
		expect(res.body.apiConnection.name).not.toBe('Local directory');
	});

	it('API-IDN-MAN-22: audit row on user create', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'audit-user' }))
			.expect(201);
		const audit = await prisma.auditEvent.findFirst({
			where: {
				category: 'identity',
				subjectId: created.body.user.id,
			},
		});
		expect(audit).not.toBeNull();
	});

	it('API-IDN-MAN-23: PATCH memberships replace and omit (manual groups only — Prompt 37 invariant)', async () => {
		// A manual (local-directory) user may only be assigned manual groups; a synced group from another
		// source is rejected by the membership-within-source invariant.
		const conn = await createTestApiConnection(prisma);
		const syncedGroup = await createTestGroup(prisma, conn.id, { name: 'sync-grp' });
		const { agent, csrf } = await adminAgent();
		const manualGrpA = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'man-grp-a' })
			.expect(201);
		const manualGrpB = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'man-grp-b' })
			.expect(201);
		const user = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ groupIds: [manualGrpA.body.group.id] }))
			.expect(201);
		const userId = user.body.user.id as string;
		// Cross-source synced group is rejected (membership-within-source invariant).
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${userId}`)
			.set(csrfHeader(csrf))
			.send({ groupIds: [syncedGroup.id] })
			.expect(400);
		// Replacing with another manual group works.
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${userId}`)
			.set(csrfHeader(csrf))
			.send({ groupIds: [manualGrpB.body.group.id] })
			.expect(200);
		const after = await agent.get(`${IDENTITY_USERS_API_PATH}/${userId}`).expect(200);
		expect(after.body.groups.map((g: { id: string }) => g.id)).toEqual([manualGrpB.body.group.id]);
		// Omitting groupIds keeps the existing membership.
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${userId}`)
			.set(csrfHeader(csrf))
			.send({ displayName: 'Kept groups' })
			.expect(200);
		const afterOmit = await agent.get(`${IDENTITY_USERS_API_PATH}/${userId}`).expect(200);
		expect(afterOmit.body.groups.map((g: { id: string }) => g.id)).toEqual([
			manualGrpB.body.group.id,
		]);
	});

	it('API-IDN-MAN-24: inactive manual user cannot login', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'inactive-man', active: false }))
			.expect(201);
		void created;
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'inactive-man', password: manualPassword })
			.expect(401);
	});

	it('API-IDN-MAN-30: group detail includes members', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'detail-grp' })
			.expect(201);
		const user = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ groupIds: [group.body.group.id] }))
			.expect(201);
		const res = await agent.get(`${IDENTITY_GROUPS_API_PATH}/${group.body.group.id}`).expect(200);
		expect(res.body.members.some((m: { id: string }) => m.id === user.body.user.id)).toBe(true);
	});

	it('API-IDN-MAN-31: role detail includes members', async () => {
		const { agent, csrf } = await adminAgent();
		const role = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'detail-role' })
			.expect(201);
		const user = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ roleIds: [role.body.role.id] }))
			.expect(201);
		const res = await agent.get(`${IDENTITY_ROLES_API_PATH}/${role.body.role.id}`).expect(200);
		expect(res.body.members.some((m: { id: string }) => m.id === user.body.user.id)).toBe(true);
	});

	it('API-IDN-MAN-32: list groups origin=manual', async () => {
		const conn = await createTestApiConnection(prisma);
		await createTestGroup(prisma, conn.id, { name: 'sync-only-grp' });
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'manual-only-grp' })
			.expect(201);
		const res = await agent.get(`${IDENTITY_GROUPS_API_PATH}?origin=manual`).expect(200);
		expect(res.body.items.every((g: { origin: string }) => g.origin === 'manual')).toBe(true);
	});

	it('API-IDN-MAN-33: POST password !== confirmPassword → 400', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				username: 'mismatch',
				password: manualPassword,
				confirmPassword: 'other-pass-99',
			})
			.expect(400);
	});

	it('API-IDN-MAN-34: manual user detail source local_directory', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'src-manual' }))
			.expect(201);
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}`).expect(200);
		expect(res.body.source.kind).toBe('local_directory');
	});

	it('API-IDN-MAN-35: synced user detail source api_connection', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Source HR' });
		const synced = await createTestUser(prisma, conn.id, { username: 'src-synced' });
		const { agent } = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}/${synced.id}`).expect(200);
		expect(res.body.source.kind).toBe('api_connection');
		expect(res.body.source.label).toContain('Source HR');
	});

	it('API-IDN-MAN-36: auditLimit returns recent events', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'audit-limit-user' }))
			.expect(201);
		const res = await agent
			.get(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}?auditLimit=5`)
			.expect(200);
		expect(Array.isArray(res.body.recentAudit)).toBe(true);
		expect(res.body.recentAudit.length).toBeGreaterThanOrEqual(1);
	});

	it('API-IDN-MAN-37: DELETE manual user clears SamlSession.userId (SetNull)', async () => {
		const sp = await createTestSpConnection(prisma);
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'saml-del-user' }))
			.expect(201);
		const userId = created.body.user.id as string;
		const session = await createTestSamlSession(prisma, sp.id, { userId });
		await agent.delete(`${IDENTITY_USERS_API_PATH}/${userId}`).set(csrfHeader(csrf)).expect(204);
		const after = await prisma.samlSession.findUnique({ where: { id: session.id } });
		expect(after).not.toBeNull();
		expect(after?.userId).toBeNull();
	});

	it('API-IDN-MAN-SAML-01: manual user can login after create', async () => {
		const { agent, csrf } = await adminAgent();
		const username = `saml-man-${randomUUID().slice(0, 6)}`;
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username }))
			.expect(201);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username, password: manualPassword })
			.expect(200);
	});

	it('API-IDN-MAN-38: POST password shorter than 8 → 400', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				username: 'short-pass',
				password: 'short',
				confirmPassword: 'short',
			})
			.expect(400);
	});

	it('API-IDN-MAN-39: POST invalid email format → 400', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({
				...manualUserBody({ username: 'bad-email-user' }),
				email: 'not-an-email',
			})
			.expect(400);
	});

	it('API-IDN-MAN-40: POST with unknown groupId → 400', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(
				manualUserBody({
					username: 'bad-grp-user',
					groupIds: ['clxxxxxxxxxxxxxxxxxxxxxxxxx'],
				}),
			)
			.expect(400);
	});

	it('API-IDN-MAN-41: GET users origin=manual returns only manual rows', async () => {
		const conn = await createTestApiConnection(prisma);
		await createTestUser(prisma, conn.id, { username: 'sync-list-user' });
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'manual-list-user' }))
			.expect(201);
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}?origin=manual`).expect(200);
		expect(res.body.items.every((u: { origin: string }) => u.origin === 'manual')).toBe(true);
		expect(
			res.body.items.some((u: { username: string }) => u.username === 'manual-list-user'),
		).toBe(true);
		void csrf;
	});

	it('API-IDN-MAN-42: GET users origin=synced excludes manual users', async () => {
		const conn = await createTestApiConnection(prisma);
		const synced = await createTestUser(prisma, conn.id, { username: 'only-synced-list' });
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'only-manual-list' }))
			.expect(201);
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}?origin=synced`).expect(200);
		expect(res.body.items.every((u: { origin: string }) => u.origin === 'synced')).toBe(true);
		expect(res.body.items.some((u: { id: string }) => u.id === synced.id)).toBe(true);
	});

	it('API-IDN-MAN-43: auditLimit=0 omits recentAudit on user detail', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'no-audit-user' }))
			.expect(201);
		const res = await agent
			.get(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}?auditLimit=0`)
			.expect(200);
		expect(res.body.recentAudit).toBeUndefined();
	});

	it('API-IDN-MAN-44: auditLimit above max → 400', async () => {
		const { agent } = await adminAgent();
		const created = await prisma.user.findFirst({ where: { origin: IdentityOrigin.MANUAL } });
		await agent.get(`${IDENTITY_USERS_API_PATH}/${created!.id}?auditLimit=99`).expect(400);
	});

	it('API-IDN-MAN-45: PATCH local directory API connection → 403', async () => {
		const local = await prisma.apiConnection.findFirst({ where: { isLocalDirectory: true } });
		const { agent, csrf } = await adminAgent();
		await agent
			.patch(`${API_CONNECTIONS_API_PATH}/${local!.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'Renamed Local' })
			.expect(403);
	});

	it('API-IDN-MAN-46: PATCH user without password keeps login working', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'keep-pass-user' }))
			.expect(201);
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}`)
			.set(csrfHeader(csrf))
			.send({ displayName: 'Still works' })
			.expect(200);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'keep-pass-user', password: manualPassword })
			.expect(200);
	});

	it('API-IDN-MAN-47: POST user with unknown field → 400 forbidNonWhitelisted', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ ...manualUserBody(), extraField: true })
			.expect(400);
	});

	it('API-IDN-MAN-48: DELETE group without CSRF → 403', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'csrf-grp' })
			.expect(201);
		const bare = request.agent(app.getHttpServer() as App);
		await loginAgent(bare);
		await bare.delete(`${IDENTITY_GROUPS_API_PATH}/${group.body.group.id}`).expect(403);
	});

	it('API-IDN-MAN-49: group and role mutations write identity audit events', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'audit-grp' })
			.expect(201);
		const role = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'audit-role' })
			.expect(201);
		const grpAudit = await prisma.auditEvent.findFirst({
			where: { category: 'identity', subjectId: group.body.group.id },
		});
		const roleAudit = await prisma.auditEvent.findFirst({
			where: { category: 'identity', subjectId: role.body.role.id },
		});
		expect(grpAudit?.event).toContain('group');
		expect(roleAudit?.event).toContain('role');
	});

	it('API-IDN-MAN-50: invalid user id format on PATCH → 400', async () => {
		const { agent, csrf } = await adminAgent();
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/not-a-cuid`)
			.set(csrfHeader(csrf))
			.send({ displayName: 'x' })
			.expect(400);
	});

	it('API-IDN-MAN-51: PATCH synced role → 403; DELETE synced role → 403', async () => {
		const conn = await createTestApiConnection(prisma);
		const syncedRole = await createTestRole(prisma, conn.id, { name: 'sync-role-edit' });
		const { agent, csrf } = await adminAgent();
		await agent
			.patch(`${IDENTITY_ROLES_API_PATH}/${syncedRole.id}`)
			.set(csrfHeader(csrf))
			.send({ name: 'nope' })
			.expect(403);
		await agent
			.delete(`${IDENTITY_ROLES_API_PATH}/${syncedRole.id}`)
			.set(csrfHeader(csrf))
			.expect(403);
	});

	it('API-IDN-MAN-52: PATCH user clears all group memberships with empty array', async () => {
		const { agent, csrf } = await adminAgent();
		const group = await agent
			.post(IDENTITY_GROUPS_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'clear-grp' })
			.expect(201);
		const user = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'clear-grp-user', groupIds: [group.body.group.id] }))
			.expect(201);
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${user.body.user.id}`)
			.set(csrfHeader(csrf))
			.send({ groupIds: [] })
			.expect(200);
		const after = await agent.get(`${IDENTITY_USERS_API_PATH}/${user.body.user.id}`).expect(200);
		expect(after.body.groups).toEqual([]);
	});

	it('API-IDN-MAN-53: list roles origin=manual and memberCount present', async () => {
		const conn = await createTestApiConnection(prisma);
		await createTestRole(prisma, conn.id, { name: 'sync-role-only' });
		const { agent, csrf } = await adminAgent();
		const role = await agent
			.post(IDENTITY_ROLES_API_PATH)
			.set(csrfHeader(csrf))
			.send({ name: 'manual-role-list' })
			.expect(201);
		const res = await agent.get(`${IDENTITY_ROLES_API_PATH}?origin=manual`).expect(200);
		const row = res.body.items.find((r: { id: string }) => r.id === role.body.role.id);
		expect(row?.origin).toBe('manual');
		expect(row?.memberCount).toBe(0);
		void csrf;
	});

	it('API-IDN-MAN-54: confirmPassword never stored in database', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'no-confirm-store' }))
			.expect(201);
		const row = await prisma.user.findUnique({ where: { id: created.body.user.id } });
		expect(row?.passwordHash).not.toContain('confirm');
		expect(row?.passwordHash).toMatch(/^\$2[aby]\$/);
	});

	it('API-IDN-MAN-55: PATCH manual user can change password and login with new one', async () => {
		const { agent, csrf } = await adminAgent();
		const created = await agent
			.post(IDENTITY_USERS_API_PATH)
			.set(csrfHeader(csrf))
			.send(manualUserBody({ username: 'pw-change-user' }))
			.expect(201);
		const newPass = 'new-pass-99';
		await agent
			.patch(`${IDENTITY_USERS_API_PATH}/${created.body.user.id}`)
			.set(csrfHeader(csrf))
			.send({ password: newPass })
			.expect(200);
		await request(app.getHttpServer() as App)
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'pw-change-user', password: newPass })
			.expect(200);
	});
});
