import type { PrismaClient } from '@prisma/client';
import { createLibsqlClient } from '@api/prisma/libsql';
import { applyMigrations } from '@api/prisma/db-migrator';

/** Clears identity/sync rows that reference ApiConnection (FK order matters). */
export async function clearApiConnectionScopedTestData(
	prisma: Pick<
		PrismaClient,
		| 'samlSession'
		| 'userGroup'
		| 'userRole'
		| 'user'
		| 'group'
		| 'role'
		| 'syncLog'
		| 'apiConnection'
	>,
): Promise<void> {
	await prisma.samlSession.deleteMany();
	await prisma.userGroup.deleteMany();
	await prisma.userRole.deleteMany();
	await prisma.user.deleteMany();
	await prisma.group.deleteMany();
	await prisma.role.deleteMany();
	await prisma.syncLog.deleteMany();
	await prisma.apiConnection.deleteMany();
}

/**
 * Apply the migration history to a fresh test database file through the libSQL client (the same
 * runtime migrator the app uses on boot). Test DBs are unencrypted for speed.
 */
export async function runMigrationsOnTestDb(databaseUrl: string): Promise<void> {
	const client = createLibsqlClient({ url: databaseUrl, encryptionKey: undefined });
	try {
		await applyMigrations(client);
	} finally {
		client.close();
	}
}
