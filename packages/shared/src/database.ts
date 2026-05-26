/** Supported Prisma datasource providers for NestIdP deployments. */
export const DATABASE_PROVIDERS = ['sqlite', 'postgresql'] as const;

export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];

export const DEFAULT_DATABASE_PROVIDER: DatabaseProvider = 'sqlite';

export function isDatabaseProvider(value: string): value is DatabaseProvider {
	return (DATABASE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Validates that DATABASE_URL matches the selected provider.
 * Keeps schemas portable — avoid provider-specific field annotations in Prisma models.
 */
export function validateDatabaseUrlForProvider(provider: DatabaseProvider, url: string): void {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new Error('DATABASE_URL must not be empty');
	}

	switch (provider) {
		case 'sqlite':
			if (!trimmed.startsWith('file:')) {
				throw new Error('DATABASE_URL for sqlite must use the file: scheme');
			}
			return;
		case 'postgresql':
			if (!/^postgres(?:ql)?:\/\//.test(trimmed)) {
				throw new Error('DATABASE_URL for postgresql must use postgres:// or postgresql://');
			}
			return;
		default: {
			const _exhaustive: never = provider;
			throw new Error(`Unsupported database provider: ${_exhaustive}`);
		}
	}
}
