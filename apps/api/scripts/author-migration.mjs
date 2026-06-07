#!/usr/bin/env node
/**
 * Author a new migration. `prisma migrate dev` cannot open the encrypted runtime DB, so it runs
 * against an unencrypted scratch file purely to GENERATE prisma/migrations/<name>/migration.sql.
 * The runtime migrator then applies that SQL to the real (encrypted) database on boot.
 *
 *   pnpm db:new-migration <name>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) {
	console.error('Usage: pnpm db:new-migration <name>');
	process.exit(1);
}

const scratch = resolve(apiRoot, 'prisma/.scratch.db');
for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`, `${scratch}-journal`]) {
	if (existsSync(f)) rmSync(f);
}

try {
	execFileSync('npx', ['prisma', 'migrate', 'dev', '--name', name], {
		cwd: apiRoot,
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: `file:${scratch}` },
	});
} finally {
	for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`, `${scratch}-journal`]) {
		if (existsSync(f)) rmSync(f);
	}
}
