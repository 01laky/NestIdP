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
import { AdminModule } from '@api/admin/admin.module';
import { AdminAuthModule } from '@api/admin-auth/admin-auth.module';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	createTestAdminUserWithPassword,
	createTestIdpSettingsWithSigningKey,
	createTestSpConnection,
	getTestSigningMaterial,
} from '@test/support/prisma/test-fixtures';

jest.setTimeout(60_000);

describe('Admin dashboard request security (SQLite)', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let databaseUrl: string;
	const adminPassword = 'dash-req-security-pass';

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-admin-req-security-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');

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
							DATABASE_PROVIDER: 'sqlite',
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
		await createTestIdpSettingsWithSigningKey(prisma, {
			entityId: 'http://localhost:3000',
			wantAuthnRequestsSigned: true,
		});
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

	it('API-ADM-DASH-REQ-01: dashboard includes request-signature security summary counters', async () => {
		const certPem = getTestSigningMaterial('urn:test:sp:dash').certPem;
		await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:dash-signed:${Date.now()}`,
			spCertificate: certPem,
			wantAuthnRequestsSigned: true,
		});
		await createTestSpConnection(prisma, {
			spEntityId: `urn:test:sp:dash-encrypted-missing-cert:${Date.now()}`,
			spCertificate: null,
			wantAssertionsEncrypted: true,
		});

		const agent = request.agent(app.getHttpServer() as App);
		await agent
			.post('/api/admin/auth/login')
			.send({ username: 'admin', password: adminPassword })
			.expect(200);

		const res = await agent.get('/api/admin').expect(200);
		expect(res.body.spSecurity).toMatchObject({
			spConnectionsRequireSignedAuthn: 1,
			spConnectionsRequireEncryptedAssertions: 1,
			spConnectionsMissingCertWithSecurityFlags: 1,
			idpAdvertisesSignedAuthnRequests: true,
		});
	});
});
