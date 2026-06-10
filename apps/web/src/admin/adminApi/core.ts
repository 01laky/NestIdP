import type { ApiErrorResponseDto } from '@nestidp/shared';
import { ADMIN_CSRF_HEADER_NAME } from '@nestidp/shared';

/**
 * Core admin-API plumbing shared by every domain module (Prompt 38 §6.9): the {@link AdminApiError} class,
 * the CSRF-token holder, the {@link adminFetch} wrapper and the {@link toQuery} query-string builder. The
 * domain modules (auth, connections, identity, …) import from here and are re-exported by `../adminApi`.
 */
export class AdminApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		/** Seconds from the `Retry-After` header on a 429 throttle/lockout response (Prompt 35). */
		public readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = 'AdminApiError';
	}
}

function parseRetryAfterSeconds(response: Response): number | undefined {
	const raw = response.headers?.get?.('Retry-After');
	if (!raw) {
		return undefined;
	}
	const seconds = Number.parseInt(raw, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
	csrfToken = token;
}

export function getCsrfToken(): string | null {
	return csrfToken;
}

function isMutatingMethod(method: string | undefined): boolean {
	const normalized = (method ?? 'GET').toUpperCase();
	return normalized === 'POST' || normalized === 'PATCH' || normalized === 'DELETE';
}

async function parseErrorResponse(response: Response): Promise<ApiErrorResponseDto> {
	try {
		const body = (await response.json()) as Partial<ApiErrorResponseDto>;
		return {
			statusCode: body.statusCode ?? response.status,
			message: body.message ?? response.statusText,
		};
	} catch {
		return {
			statusCode: response.status,
			message: response.statusText || 'Request failed',
		};
	}
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const method = init.method ?? 'GET';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(init.headers as Record<string, string> | undefined),
	};

	if (csrfToken && isMutatingMethod(method)) {
		headers[ADMIN_CSRF_HEADER_NAME] = csrfToken;
	}

	const response = await fetch(path, {
		...init,
		credentials: 'include',
		headers,
	});

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		throw new AdminApiError(error.statusCode, error.message, parseRetryAfterSeconds(response));
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

/**
 * Builds a `?a=b&c=d` query suffix from a record, skipping `undefined`/`''` values and returning `''`
 * when nothing survives (Prompt 38 §6.9). One shared serialiser for every admin GET that takes optional
 * filters. Booleans are stringified (`false` → `'false'`), so a present-but-false flag is still sent.
 */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') {
			query.set(key, String(value));
		}
	}
	return query.size > 0 ? `?${query.toString()}` : '';
}
