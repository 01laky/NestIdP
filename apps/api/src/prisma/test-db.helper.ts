import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const apiRoot = resolve(__dirname, '../..');

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
