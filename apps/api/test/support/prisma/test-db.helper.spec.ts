import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(30_000);

describe('test-db.helper', () => {
	it('API-DBH-01: runMigrationsOnTestDb creates usable schema on temp SQLite file', async () => {
		const tmpDb = join(tmpdir(), `nestidp-helper-${randomUUID()}.db`);
		const databaseUrl = `file:${tmpDb}`;

		await runMigrationsOnTestDb(databaseUrl);
		expect(existsSync(tmpDb)).toBe(true);

		const prisma = new PrismaClient({
			datasources: { db: { url: databaseUrl } },
		});

		return prisma.$queryRaw<Array<{ name: string }>>`
			SELECT name FROM sqlite_master WHERE type='table' AND name='User'
		`.then(async (tables) => {
			expect(tables.some((t) => t.name === 'User')).toBe(true);
			await prisma.$disconnect();
			unlinkSync(tmpDb);
		});
	});
});
