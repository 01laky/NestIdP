import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildLibsqlAdapter } from '../libsql';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
	/**
	 * No-arg in production (reads DATABASE_URL / key from the environment). Tests may pass a specific
	 * file via `{ url }` or the legacy `{ datasources: { db: { url } } }` shape, plus an optional
	 * `encryptionKey`, and the adapter is built for that file.
	 */
	constructor(options?: {
		url?: string;
		encryptionKey?: string;
		datasources?: { db?: { url?: string } };
	}) {
		const url = options?.url ?? options?.datasources?.db?.url;
		const env =
			url !== undefined
				? {
						...process.env,
						DATABASE_URL: url,
						...(options?.encryptionKey !== undefined
							? { DATABASE_ENCRYPTION_KEY: options.encryptionKey }
							: { DATABASE_ENCRYPTION_KEY: undefined, DATABASE_ENCRYPTION_KEY_FILE: undefined }),
					}
				: process.env;
		super({ adapter: buildLibsqlAdapter(env) });
	}

	async onModuleDestroy(): Promise<void> {
		await this.$disconnect();
	}

	async pingDatabase(): Promise<boolean> {
		try {
			await this.$queryRaw`SELECT 1`;
			return true;
		} catch {
			return false;
		}
	}

	/** Number of applied schema migrations (from the migrator's tracking table). 0 if unavailable. */
	async appliedMigrationCount(): Promise<number> {
		try {
			const rows = await this.$queryRawUnsafe<Array<{ n: bigint | number }>>(
				'SELECT COUNT(*) AS n FROM "__app_migrations"',
			);
			return Number(rows[0]?.n ?? 0);
		} catch {
			return 0;
		}
	}
}
