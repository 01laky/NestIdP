import { readFileSync, writeFileSync } from 'fs';
import {
	DatabaseProvider,
	DEFAULT_DATABASE_PROVIDER,
	isDatabaseProvider,
	validateDatabaseUrlForProvider,
} from '@nestidp/shared';

const PRISMA_PROVIDER_PATTERN = /provider\s*=\s*"(?:sqlite|postgresql)"/;

export function resolveDatabaseProvider(value: unknown): DatabaseProvider {
	if (value === undefined || value === null || value === '') {
		return DEFAULT_DATABASE_PROVIDER;
	}
	if (typeof value !== 'string' || !isDatabaseProvider(value)) {
		throw new Error(`DATABASE_PROVIDER must be one of: sqlite, postgresql (got: ${String(value)})`);
	}
	return value;
}

export function assertDatabaseConfig(provider: DatabaseProvider, databaseUrl: string): void {
	validateDatabaseUrlForProvider(provider, databaseUrl);
}

/** Syncs the provider line in schema.prisma before prisma generate / migrate. */
export function syncPrismaSchemaProvider(schemaPath: string, provider: DatabaseProvider): void {
	const content = readFileSync(schemaPath, 'utf8');
	if (!PRISMA_PROVIDER_PATTERN.test(content)) {
		throw new Error(`Could not find datasource provider in ${schemaPath}`);
	}
	const updated = content.replace(PRISMA_PROVIDER_PATTERN, `provider = "${provider}"`);
	if (updated === content) {
		return;
	}
	writeFileSync(schemaPath, updated);
}
