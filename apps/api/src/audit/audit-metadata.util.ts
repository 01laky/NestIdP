const METADATA_KEY_DENYLIST = [
	'password',
	'passwordhash',
	'token',
	'bearertoken',
	'secret',
	'authorization',
	'pem',
	'privatekey',
	'signingprivatekeypem',
	'signingcertpem',
	'authcredentialsencrypted',
];

const METADATA_MAX_BYTES = 4096;

export function sanitizeAuditMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	if (!metadata || typeof metadata !== 'object') {
		return null;
	}

	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (METADATA_KEY_DENYLIST.includes(key.toLowerCase())) {
			continue;
		}
		sanitized[key] = value;
	}

	const serialized = JSON.stringify(sanitized);
	if (serialized.length > METADATA_MAX_BYTES) {
		return { truncated: true, previewBytes: METADATA_MAX_BYTES };
	}
	return sanitized;
}
