/**
 * Secret-key substrings (§5.A12). A metadata key is redacted when its lower-cased name *contains* any of
 * these — broader than the old exact-match list so variants like `oauthClientSecret`, `apiKey`,
 * `signingKeyEncrypted`, or a nested `userPassword` are caught. Deliberately NOT including `session`/`id`
 * so genuine identifiers (e.g. `ssoSessionId`, `sessionIndex`) stay in the audit trail.
 */
const SECRET_KEY_SUBSTRINGS = [
	'password',
	'secret',
	'token',
	'authorization',
	'privatekey',
	'pem',
	'credential',
	'encrypted',
	'apikey',
	'bearer',
];

const METADATA_MAX_BYTES = 4096;
const MAX_REDACTION_DEPTH = 8;

function isSecretKey(key: string): boolean {
	const lower = key.toLowerCase();
	return SECRET_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/**
 * Recursively drop secret-named keys at ANY depth (§5.A12 — the old version only scrubbed top-level keys,
 * so a nested `{ details: { password } }` leaked). Depth is bounded to defend against deeply-nested or
 * adversarial structures.
 */
function redactDeep(value: unknown, depth: number): unknown {
	if (depth > MAX_REDACTION_DEPTH) {
		return '[depth-limited]';
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactDeep(entry, depth + 1));
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (isSecretKey(key)) {
				continue;
			}
			out[key] = redactDeep(entry, depth + 1);
		}
		return out;
	}
	return value;
}

export function sanitizeAuditMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		return null;
	}

	const sanitized = redactDeep(metadata, 0) as Record<string, unknown>;

	const serialized = JSON.stringify(sanitized);
	// Measure real UTF-8 byte length, not JS string (UTF-16 code-unit) length (§5.A12).
	if (Buffer.byteLength(serialized, 'utf8') > METADATA_MAX_BYTES) {
		return { truncated: true, previewBytes: METADATA_MAX_BYTES };
	}
	return sanitized;
}
