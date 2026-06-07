/**
 * NestIdP stores all data in a single libSQL (SQLite-compatible) file, optionally encrypted at rest.
 * There is no multi-provider concept — `DATABASE_URL` must always use the `file:` scheme.
 */
export function validateDatabaseUrl(url: string): void {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new Error('DATABASE_URL must not be empty');
	}
	if (!trimmed.startsWith('file:')) {
		throw new Error('DATABASE_URL must use the file: scheme (libSQL local file)');
	}
}
