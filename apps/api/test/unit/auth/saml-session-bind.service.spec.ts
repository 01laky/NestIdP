import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestApiConnection,
	createTestSpConnection,
	createTestSamlSession,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { SamlSessionBindService } from '@api/auth/services/saml-session-bind.service';

jest.setTimeout(60_000);

describe('SamlSessionBindService (SQLite)', () => {
	let prisma: PrismaClient;
	let service: SamlSessionBindService;
	let databaseUrl: string;
	let spConnectionId: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-saml-bind-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		service = new SamlSessionBindService(prisma as unknown as PrismaService);
		const sp = await createTestSpConnection(prisma);
		spConnectionId = sp.id;
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-AUTH-SAML-BIND-01: binds user to open SAML session', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id, { username: 'bind-user-1' });
		const session = await createTestSamlSession(prisma, spConnectionId);

		await service.bindUserToSession(session.id, user.id);

		const updated = await prisma.samlSession.findUnique({ where: { id: session.id } });
		expect(updated?.userId).toBe(user.id);
	});

	it('API-AUTH-SAML-BIND-02: unknown session id → 400', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		await expect(service.bindUserToSession('clxxxxxxxxxxxxxxxxxxxxxxxxx', user.id)).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-AUTH-SAML-BIND-03: expired session → 400', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id);
		const session = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 1000),
		});

		await expect(service.bindUserToSession(session.id, user.id)).rejects.toThrow(
			'SAML session expired',
		);
	});

	it('API-AUTH-SAML-BIND-04: already bound session → 409', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id, { username: 'bind-user-4' });
		const other = await createTestUser(prisma, connection.id, { username: 'bind-user-4b' });
		const session = await createTestSamlSession(prisma, spConnectionId, { userId: user.id });

		await expect(service.bindUserToSession(session.id, other.id)).rejects.toThrow(
			ConflictException,
		);
	});

	it('API-AUTH-SAML-BIND-05: inactive SP connection → 400', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUser(prisma, connection.id, { username: 'bind-user-5' });
		const inactiveSp = await createTestSpConnection(prisma, { active: false });
		const session = await createTestSamlSession(prisma, inactiveSp.id);

		await expect(service.bindUserToSession(session.id, user.id)).rejects.toThrow(
			'SP connection is inactive',
		);
	});
});
