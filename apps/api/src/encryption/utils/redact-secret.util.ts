export function redactBearerToken(value: string | undefined | null): string {
	if (value == null || value.length === 0 || value.length <= 8) {
		return '[redacted]';
	}
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Scrub OAuth/Bearer secrets from an arbitrary string before logging or surfacing it.
 * Removes `client_secret`/`access_token` values (form, JSON, query) and `Authorization` header
 * values (Bearer + Basic). Intentionally aggressive — never leak a credential through an error.
 */
export function redactSecrets(input: string | undefined | null): string {
	if (input == null) {
		return '';
	}
	let out = String(input);
	// key=value (form/query) and "key":"value" (JSON) for sensitive keys
	const sensitiveKeys = [
		'client_secret',
		'access_token',
		'refresh_token',
		'id_token',
		'assertion',
		'password',
	];
	for (const key of sensitiveKeys) {
		out = out.replace(new RegExp(`(${key})(=)([^&\\s"']+)`, 'gi'), '$1$2[redacted]');
		out = out.replace(new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`, 'gi'), '$1[redacted]$3');
	}
	// Authorization headers (Bearer / Basic)
	out = out.replace(/(authorization\s*[:=]\s*)(bearer|basic)\s+[^\s"',}]+/gi, '$1$2 [redacted]');
	return out;
}
