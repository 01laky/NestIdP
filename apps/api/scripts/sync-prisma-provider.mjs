import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
const repoRoot = resolve(apiRoot, '../..');
const schemaPath = resolve(apiRoot, 'prisma/schema.prisma');

const DATABASE_PROVIDERS = ['sqlite', 'postgresql'];
const DEFAULT_DATABASE_PROVIDER = 'sqlite';
const PRISMA_PROVIDER_PATTERN = /provider\s*=\s*"(?:sqlite|postgresql)"/;

for (const envPath of [
	resolve(repoRoot, '.env'),
	resolve(apiRoot, '.env'),
	resolve(apiRoot, 'prisma/.env'),
]) {
	if (existsSync(envPath)) {
		loadDotenv({ path: envPath });
	}
}

function resolveDatabaseProvider(value) {
	if (value === undefined || value === null || value === '') {
		return DEFAULT_DATABASE_PROVIDER;
	}
	if (!DATABASE_PROVIDERS.includes(value)) {
		throw new Error(
			`DATABASE_PROVIDER must be one of: ${DATABASE_PROVIDERS.join(', ')} (got: ${String(value)})`,
		);
	}
	return value;
}

function assertDatabaseConfig(provider, databaseUrl) {
	const trimmed = databaseUrl.trim();
	if (!trimmed) {
		throw new Error('DATABASE_URL must not be empty');
	}
	if (provider === 'sqlite' && !trimmed.startsWith('file:')) {
		throw new Error('DATABASE_URL for sqlite must use the file: scheme');
	}
	if (provider === 'postgresql' && !/^postgres(?:ql)?:\/\//.test(trimmed)) {
		throw new Error('DATABASE_URL for postgresql must use postgres:// or postgresql://');
	}
}

function syncPrismaSchemaProvider(path, provider) {
	const content = readFileSync(path, 'utf8');
	if (!PRISMA_PROVIDER_PATTERN.test(content)) {
		throw new Error(`Could not find datasource provider in ${path}`);
	}
	const updated = content.replace(PRISMA_PROVIDER_PATTERN, `provider = "${provider}"`);
	if (updated !== content) {
		writeFileSync(path, updated);
	}
}

const provider = resolveDatabaseProvider(process.env.DATABASE_PROVIDER);
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
	assertDatabaseConfig(provider, databaseUrl);
}

syncPrismaSchemaProvider(schemaPath, provider);
console.log(`[prisma:prepare] datasource provider set to "${provider}"`);
