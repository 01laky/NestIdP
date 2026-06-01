import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runBootstrap } from '../src/bootstrap/run-bootstrap';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env') });

async function main(): Promise<void> {
	const prisma = new PrismaClient();

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
