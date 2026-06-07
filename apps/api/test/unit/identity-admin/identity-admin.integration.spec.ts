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
	IDENTITY_GROUPS_API_PATH,
	IDENTITY_ROLES_API_PATH,
	IDENTITY_USERS_API_PATH,
} from '@nestidp/shared';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { IdentityAdminModule } from '@api/identity-admin/identity-admin.module';

jest.setTimeout(60_000);

describe('Identity admin API (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'identity-admin-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-identity-admin-${randomUUID()}.db`);
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
							ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
							IDP_BASE_URL: 'http://localhost:3000',
							NODE_ENV: 'test',
						}),
					],
				}),
				PrismaModule,
				AdminAuthModule,
				IdentityAdminModule,
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

	async function adminAgent(): Promise<request.Agent> {
		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		return agent;
	}

	it('API-IDN-ADM-01: list users without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(IDENTITY_USERS_API_PATH)
			.expect(401);
	});

	it('API-IDN-ADM-02: list users returns synced user', async () => {
		const conn = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, conn.id, {
			username: 'alice',
			email: 'a@example.com',
		});
		const agent = await adminAgent();
		const res = await agent.get(IDENTITY_USERS_API_PATH).expect(200);
		expect(res.body.items.some((row: { id: string }) => row.id === user.id)).toBe(true);
		expect(res.body.total).toBeGreaterThanOrEqual(1);
	});

	it('API-IDN-ADM-03: search filters by username', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Search API' });
		await createTestUser(prisma, conn.id, { username: 'searchable-user' });
		await createTestUser(prisma, conn.id, { username: 'other-user-zz' });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}?search=searchable`).expect(200);
		expect(
			res.body.items.every((row: { username: string }) => row.username.includes('searchable')),
		).toBe(true);
	});

	it('API-IDN-ADM-04: user detail includes groups and roles', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Detail API' });
		const user = await createTestUser(prisma, conn.id, { username: 'detail-user' });
		const group = await createTestGroup(prisma, conn.id, { name: 'admins' });
		const role = await createTestRole(prisma, conn.id, { name: 'viewer' });
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
		await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}/${user.id}`).expect(200);
		expect(res.body.user.id).toBe(user.id);
		expect(res.body.groups.map((g: { name: string }) => g.name)).toContain('admins');
		expect(res.body.roles.map((r: { name: string }) => r.name)).toContain('viewer');
	});

	it('API-IDN-ADM-05: unknown user → 404', async () => {
		const agent = await adminAgent();
		await agent.get(`${IDENTITY_USERS_API_PATH}/clxxxxxxxxxxxxxxxxxxxxxxxxx`).expect(404);
	});

	it('API-IDN-ADM-06: list groups', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Groups API' });
		await createTestGroup(prisma, conn.id, { name: 'team-a' });
		const agent = await adminAgent();
		const res = await agent.get(IDENTITY_GROUPS_API_PATH).expect(200);
		expect(res.body.items.length).toBeGreaterThanOrEqual(1);
	});

	it('API-IDN-ADM-07: list roles', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Roles API' });
		await createTestRole(prisma, conn.id, { name: 'role-a' });
		const agent = await adminAgent();
		const res = await agent.get(IDENTITY_ROLES_API_PATH).expect(200);
		expect(res.body.items.length).toBeGreaterThanOrEqual(1);
	});

	it('API-IDN-ADM-08: invalid limit → 400', async () => {
		const agent = await adminAgent();
		await agent.get(`${IDENTITY_USERS_API_PATH}?limit=9999`).expect(400);
	});

	it('API-IDN-ADM-09: offset pagination returns distinct page', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Page API' });
		for (let i = 0; i < 3; i++) {
			await createTestUser(prisma, conn.id, { username: `page-user-${i}` });
		}
		const agent = await adminAgent();
		const page1 = await agent.get(`${IDENTITY_USERS_API_PATH}?limit=2&offset=0`).expect(200);
		const page2 = await agent.get(`${IDENTITY_USERS_API_PATH}?limit=2&offset=2`).expect(200);
		expect(page1.body.items).toHaveLength(2);
		expect(page2.body.items.length).toBeGreaterThanOrEqual(1);
		const ids1 = page1.body.items.map((u: { id: string }) => u.id);
		const ids2 = page2.body.items.map((u: { id: string }) => u.id);
		expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
	});

	it('API-IDN-ADM-10: negative offset → 400', async () => {
		const agent = await adminAgent();
		await agent.get(`${IDENTITY_USERS_API_PATH}?offset=-1`).expect(400);
	});

	it('API-IDN-ADM-11: limit zero → 400', async () => {
		const agent = await adminAgent();
		await agent.get(`${IDENTITY_USERS_API_PATH}?limit=0`).expect(400);
	});

	it('API-IDN-ADM-12: whitespace search returns users (no filter)', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Whitespace API' });
		await createTestUser(prisma, conn.id, { username: 'ws-user' });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}?search=%20%20`).expect(200);
		expect(res.body.items.some((u: { username: string }) => u.username === 'ws-user')).toBe(true);
	});

	it('API-IDN-ADM-13: user detail with no groups or roles', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Lonely API' });
		const user = await createTestUser(prisma, conn.id, { username: 'lonely-user' });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}/${user.id}`).expect(200);
		expect(res.body.groups).toEqual([]);
		expect(res.body.roles).toEqual([]);
	});

	it('API-IDN-ADM-14: invalid user id format → 400', async () => {
		const agent = await adminAgent();
		await agent.get(`${IDENTITY_USERS_API_PATH}/not-a-cuid`).expect(400);
	});

	it('API-IDN-ADM-15: list groups respects limit', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Limit Groups API' });
		await createTestGroup(prisma, conn.id, { name: 'g1' });
		await createTestGroup(prisma, conn.id, { name: 'g2' });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_GROUPS_API_PATH}?limit=1`).expect(200);
		expect(res.body.items).toHaveLength(1);
		expect(res.body.total).toBeGreaterThanOrEqual(2);
	});

	it('API-IDN-ADM-16: list users never exposes passwordHash', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Secret API' });
		await createTestUser(prisma, conn.id, { username: 'secret-user' });
		const agent = await adminAgent();
		const res = await agent.get(IDENTITY_USERS_API_PATH).expect(200);
		for (const row of res.body.items) {
			expect(row.passwordHash).toBeUndefined();
			expect(row.passwordHashAlgorithm).toBeUndefined();
		}
	});

	it('API-IDN-ADM-17: user detail never exposes passwordHash', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Detail Secret API' });
		const user = await createTestUser(prisma, conn.id, { username: 'detail-secret' });
		const agent = await adminAgent();
		const res = await agent.get(`${IDENTITY_USERS_API_PATH}/${user.id}`).expect(200);
		expect(res.body.user.passwordHash).toBeUndefined();
		expect(JSON.stringify(res.body)).not.toContain('passwordHash');
	});

	it('API-IDN-ADM-18: inactive user listed with active false', async () => {
		const conn = await createTestApiConnection(prisma, { name: 'Inactive API' });
		await createTestUser(prisma, conn.id, { username: 'inactive-user', active: false });
		const agent = await adminAgent();
		const res = await agent.get(IDENTITY_USERS_API_PATH).expect(200);
		const row = res.body.items.find((u: { username: string }) => u.username === 'inactive-user');
		expect(row?.active).toBe(false);
	});

	it('API-IDN-ADM-19: list groups without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(IDENTITY_GROUPS_API_PATH)
			.expect(401);
	});

	it('API-IDN-ADM-20: list roles without session → 401', async () => {
		await request(app.getHttpServer() as App)
			.get(IDENTITY_ROLES_API_PATH)
			.expect(401);
	});
});
