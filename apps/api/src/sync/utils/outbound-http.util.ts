import { getByPath } from '@nestidp/shared';
import type { Dispatcher } from 'undici';
import { normalizeBaseUrl } from '../../api-connections/utils/base-url.util';
import { ExternalApiValidationError } from '../validators/external-api.validator';

/**
 * Shared outbound-HTTP building blocks for the identity-sync client and the connection-test
 * service (Prompt 38 §6.8e). Error mapping stays caller-specific: the sync client throws
 * IdentitySyncHttpError, the test service throws ExternalApiValidationError / inspects the raw
 * Response — hence the `onOriginViolation` callback and the raw-Response return type.
 */

export function buildOutboundUrl(opts: {
	baseUrl: string;
	path: string;
	queryParams?: Record<string, string>;
	extraParams?: Record<string, string | number>;
	/** Defense-in-depth: thrown when the resolved path escapes the base origin. */
	onOriginViolation: (resolvedUrl: string) => Error;
}): string {
	const normalized = normalizeBaseUrl(opts.baseUrl);
	const url = new URL(opts.path, `${normalized}/`);
	for (const [k, v] of Object.entries(opts.queryParams ?? {})) {
		url.searchParams.set(k, v);
	}
	for (const [k, v] of Object.entries(opts.extraParams ?? {})) {
		url.searchParams.set(k, String(v));
	}
	if (url.origin !== new URL(normalized).origin) {
		throw opts.onOriginViolation(url.toString());
	}
	return url.toString();
}

/** Bearer-authenticated JSON GET with per-caller timeout and optional proxy dispatcher. */
export async function outboundFetch(opts: {
	url: string;
	bearerToken: string;
	headers: Record<string, string>;
	timeoutMs: number;
	dispatcher?: Dispatcher;
}): Promise<Response> {
	return fetch(opts.url, {
		method: 'GET',
		headers: {
			...opts.headers,
			Authorization: `Bearer ${opts.bearerToken}`,
			Accept: 'application/json',
		},
		signal: AbortSignal.timeout(opts.timeoutMs),
		...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
	} as RequestInit & { dispatcher?: Dispatcher });
}

/** Envelope extraction; `rootlessMessage` preserves the callers' historically different wording. */
export function extractArrayAt(
	body: unknown,
	responseRoot: string,
	rootlessMessage: string,
): unknown[] {
	const value = responseRoot ? getByPath(body, responseRoot) : body;
	if (!Array.isArray(value)) {
		throw new ExternalApiValidationError(
			responseRoot ? `Response did not contain an array at "${responseRoot}"` : rootlessMessage,
		);
	}
	return value;
}
