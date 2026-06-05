import { closeSync, openSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';

const apiRoot = resolve(__dirname, '../../..');
const migrationSyncLockFile = join(apiRoot, 'prisma/.test-migration-sync.lock');
const MIGRATION_SYNC_LOCK_TIMEOUT_MS = 120_000;
const MIGRATION_SYNC_LOCK_RETRY_MS = 25;

function withMigrationSyncLock(run: () => void): void {
	const started = Date.now();
	let lockFd: number | undefined;

	while (Date.now() - started < MIGRATION_SYNC_LOCK_TIMEOUT_MS) {
		try {
			lockFd = openSync(migrationSyncLockFile, 'wx');
			break;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw err;
			}
			const until = Date.now() + MIGRATION_SYNC_LOCK_RETRY_MS;
			while (Date.now() < until) {
				// spin until retry
			}
		}
	}

	if (lockFd === undefined) {
		throw new Error('Timed out waiting for Prisma migration sync lock');
	}

	try {
		run();
	} finally {
		closeSync(lockFd);
		try {
			unlinkSync(migrationSyncLockFile);
		} catch {
			// ignore stale lock cleanup
		}
	}
}

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
	const env = {
		...process.env,
		DATABASE_PROVIDER: provider,
		DATABASE_URL: databaseUrl,
	};

	withMigrationSyncLock(() => {
		execFileSync('node', ['scripts/sync-prisma-provider.mjs'], {
			cwd: apiRoot,
			env,
			stdio: 'pipe',
		});
	});

	execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
		cwd: apiRoot,
		env,
		stdio: 'pipe',
	});

	execFileSync('npx', ['prisma', 'generate'], {
		cwd: apiRoot,
		env,
		stdio: 'pipe',
	});
}
