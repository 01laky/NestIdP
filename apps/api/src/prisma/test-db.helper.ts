import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';

const apiRoot = resolve(__dirname, '../..');

/** Clears identity/sync rows that reference ApiConnection (PostgreSQL enforces FK order). */
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

export function runMigrationsOnTestDb(databaseUrl: string, provider = 'sqlite'): void {
	execFileSync('node', ['scripts/sync-prisma-provider.mjs'], {
		cwd: apiRoot,
		env: {
			...process.env,
			DATABASE_PROVIDER: provider,
			DATABASE_URL: databaseUrl,
		},
		stdio: 'pipe',
	});

	execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
		cwd: apiRoot,
		env: {
			...process.env,
			DATABASE_PROVIDER: provider,
			DATABASE_URL: databaseUrl,
		},
		stdio: 'pipe',
	});

	execFileSync('npx', ['prisma', 'generate'], {
		cwd: apiRoot,
		env: {
			...process.env,
			DATABASE_PROVIDER: provider,
			DATABASE_URL: databaseUrl,
		},
		stdio: 'pipe',
	});
}
