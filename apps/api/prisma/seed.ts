import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runBootstrap } from '../src/bootstrap/run-bootstrap';
import { buildLibsqlAdapter } from '../src/prisma/libsql';
import { runMigrations } from '../src/prisma/db-migrator';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env') });

async function main(): Promise<void> {
	// Ensure the (optionally encrypted) DB schema is current, then seed through the libSQL adapter.
	await runMigrations();
	const prisma = new PrismaClient({ adapter: buildLibsqlAdapter() });

	try {
		const result = await runBootstrap(
			prisma,
			{
				adminUsername: process.env.ADMIN_USERNAME,
				adminPassword: process.env.ADMIN_PASSWORD,
				idpBaseUrl: process.env.IDP_BASE_URL ?? 'http://localhost:3000',
				nodeEnv: process.env.NODE_ENV,
			},
			console,
		);
		console.log(
			`Seed complete: adminCreated=${result.adminCreated}, idpSettingsCreated=${result.idpSettingsCreated}`,
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
