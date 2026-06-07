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
	AUTH_API_PATH,
	DEFAULT_PASSWORD_HASH_ALGORITHM,
	SYNC_API_PATH,
} from '@nestidp/shared';
import { AdminModule } from '@api/admin/admin.module';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { LoginRateLimiterService } from '@api/admin-auth/services/login-rate-limiter.service';
import { EncryptionModule } from '@api/encryption/encryption.module';
import { IdentityModule } from '@api/identity/identity.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestAdminUserWithPassword,
	createTestApiConnection,
	TEST_PASSWORD_HASH,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { EndUserLoginRateLimiterService } from '@api/auth/services/end-user-login-rate-limiter.service';
import { AuthModule } from '@api/auth/auth.module';
import { hashPassword } from '@api/admin-auth/utils/password.util';

jest.setTimeout(60_000);

type MockIdentityUser = {
	id: string;
	username: string;
	email?: string;
	displayName?: string;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
};

function mockIdentityApiResponses(users: MockIdentityUser[]): jest.SpiedFunction<typeof fetch> {
	return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
		const urlStr =
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

		if (urlStr.endsWith('/users')) {
			const body = users.map(({ ...user }) => user);
			return { status: 200, json: async () => body } as Response;
		}

		return { status: 404, json: async () => null } as Response;
	});
}

describe('end-user auth after sync integration (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'sync-login-admin-pass';
	const syncedPlainPassword = 'synced-user-password-99';

	const sampleExternalUser: MockIdentityUser = {
		id: 'ext-sync-user',
		username: 'synced-alice',
		email: 'synced@example.com',
		displayName: 'Synced Alice',
		passwordHash: '',
		passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		active: true,
	};

	beforeAll(async () => {
		sampleExternalUser.passwordHash = await hashPassword(syncedPlainPassword);

		const tmpDb = join(tmpdir(), `nestidp-auth-sync-${randomUUID()}.db`);
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
				EncryptionModule,
				IdentityModule,
				AdminAuthModule,
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
	});

	beforeEach(async () => {
		app.get(LoginRateLimiterService).clear();
		app.get(EndUserLoginRateLimiterService).clear();
		jest.restoreAllMocks();
		await prisma.user.deleteMany();
		await prisma.syncLog.deleteMany();
		await prisma.group.deleteMany();
		await prisma.role.deleteMany();
		await prisma.apiConnection.deleteMany();
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

	it('API-AUTH-INT-27: sync user then login with synced bcrypt hash', async () => {
		const connection = await createTestApiConnection(prisma, {
			bearerToken: 'sync-bearer-token',
		});
		mockIdentityApiResponses([sampleExternalUser]);

		const adminAgent = request.agent(app.getHttpServer() as App);
		const login = await adminAgent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);
		const csrf = login.body.csrfToken as string;

		await adminAgent
			.post(`${SYNC_API_PATH}/${connection.id}`)
			.set(ADMIN_CSRF_HEADER_NAME, csrf)
			.send({})
			.expect(200);

		const userAgent = request.agent(app.getHttpServer() as App);
		const endUserLogin = await userAgent
			.post(`${AUTH_API_PATH}/login`)
			.send({ username: 'synced-alice', password: syncedPlainPassword })
			.expect(200);

		expect(endUserLogin.body.user.username).toBe('synced-alice');
		const me = await userAgent.get(`${AUTH_API_PATH}/me`).expect(200);
		expect(me.body.user.username).toBe('synced-alice');

		const stored = await prisma.user.findUnique({ where: { username: 'synced-alice' } });
		expect(stored?.passwordHash).toBe(sampleExternalUser.passwordHash);
		expect(stored?.passwordHash).not.toBe(TEST_PASSWORD_HASH);
	});
});
