export class BaseUrlValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseUrlValidationError';
	}
}

export interface AssertValidBaseUrlOptions {
	requireHttps?: boolean;
}

export function assertValidBaseUrl(raw: string, options: AssertValidBaseUrlOptions = {}): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new BaseUrlValidationError('Invalid baseUrl');
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new BaseUrlValidationError('Invalid baseUrl');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new BaseUrlValidationError('Invalid baseUrl');
	}

	if (parsed.username || parsed.password) {
		throw new BaseUrlValidationError('baseUrl must not contain credentials');
	}

	if (parsed.hash) {
		throw new BaseUrlValidationError('Invalid baseUrl');
	}

	if (options.requireHttps && parsed.protocol !== 'https:') {
		throw new BaseUrlValidationError('baseUrl must use HTTPS in production');
	}

	return normalizeBaseUrl(parsed);
}

export function normalizeBaseUrl(raw: string | URL): string {
	const parsed = typeof raw === 'string' ? new URL(raw.trim()) : raw;
	parsed.username = '';
	parsed.password = '';
	parsed.hash = '';
	if (parsed.hostname) {
		parsed.hostname = parsed.hostname.toLowerCase();
	}
	let normalized = parsed.toString();
	while (normalized.endsWith('/') && parsed.pathname !== '/') {
		normalized = normalized.slice(0, -1);
	}
	if (normalized.endsWith('/') && (parsed.pathname === '/' || parsed.pathname === '')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}
