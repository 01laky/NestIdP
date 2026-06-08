export function redactBearerToken(value: string | undefined | null): string {
	if (value == null || value.length === 0 || value.length <= 8) {
		return '[redacted]';
	}
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Scrub OAuth/Bearer/proxy secrets from an arbitrary string before logging or surfacing it.
 * Removes `client_secret`/`access_token`/`password` values (form, JSON, query), `Authorization` and
 * `Proxy-Authorization` header values (Bearer + Basic), and inline credentials embedded in a URL
 * (`http://user:pass@host` → `http://[redacted]@host`). Intentionally aggressive — never leak a
 * credential through an error or diagnostic.
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
		'proxypassword',
	];
	for (const key of sensitiveKeys) {
		out = out.replace(new RegExp(`(${key})(=)([^&\\s"']+)`, 'gi'), '$1$2[redacted]');
		out = out.replace(new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`, 'gi'), '$1[redacted]$3');
	}
	// Authorization / Proxy-Authorization header values (Bearer / Basic)
	out = out.replace(
		/((?:proxy-)?authorization\s*[:=]\s*)(bearer|basic)\s+[^\s"',}]+/gi,
		'$1$2 [redacted]',
	);
	// Inline credentials in a URL: http://user:pass@host → http://[redacted]@host
	out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@');
	return out;
}
