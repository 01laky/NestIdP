import { NodeEnv } from '../config/env.validation';

export class AcsUrlValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AcsUrlValidationError';
	}
}

export interface AssertValidAcsUrlOptions {
	requireHttps?: boolean;
}

export function assertValidAcsUrl(raw: string, nodeEnv: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new AcsUrlValidationError('Invalid ACS URL');
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new AcsUrlValidationError('Invalid ACS URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new AcsUrlValidationError('Invalid ACS URL');
	}

	if (parsed.username || parsed.password) {
		throw new AcsUrlValidationError('acsUrl must not contain credentials');
	}

	if (parsed.hash) {
		throw new AcsUrlValidationError('Invalid ACS URL');
	}

	const requireHttps = nodeEnv === NodeEnv.Production;
	if (requireHttps && parsed.protocol !== 'https:') {
		throw new AcsUrlValidationError('ACS URL must use HTTPS in production');
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
