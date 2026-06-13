import type {
	EndUserLoginRequestDto,
	EndUserLoginResponseDto,
	EndUserLogoutResponseDto,
	EndUserMeResponseDto,
	EndUserSessionStatusResponseDto,
} from '@nestidp/shared';
import { AUTH_API_PATH, SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';

export class AuthApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		/** Seconds from the `Retry-After` header on a 429 throttle/lockout response (Prompt 35). */
		public readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = 'AuthApiError';
	}
}

function parseRetryAfter(response: Response): number | undefined {
	const raw = response.headers?.get?.('Retry-After');
	if (!raw) {
		return undefined;
	}
	const seconds = Number.parseInt(raw, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

async function parseErrorResponse(
	response: Response,
): Promise<{ statusCode: number; message: string }> {
	try {
		const body = (await response.json()) as { statusCode?: number; message?: string };
		return {
			statusCode: body.statusCode ?? response.status,
			message: body.message ?? response.statusText,
		};
	} catch {
		return { statusCode: response.status, message: response.statusText || 'Request failed' };
	}
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init.headers as Record<string, string> | undefined),
		},
	});

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		throw new AuthApiError(error.statusCode, error.message, parseRetryAfter(response));
	}

	return (await response.json()) as T;
}

export function loginEndUser(body: EndUserLoginRequestDto): Promise<EndUserLoginResponseDto> {
	return authFetch<EndUserLoginResponseDto>(`${AUTH_API_PATH}/login`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function logoutEndUser(): Promise<EndUserLogoutResponseDto> {
	return authFetch<EndUserLogoutResponseDto>(`${AUTH_API_PATH}/logout`, {
		method: 'POST',
	});
}

export function getEndUserMe(): Promise<EndUserMeResponseDto> {
	return authFetch<EndUserMeResponseDto>(`${AUTH_API_PATH}/me`);
}

export function getEndUserSession(
	samlSessionId?: string,
): Promise<EndUserSessionStatusResponseDto> {
	const query =
		samlSessionId != null && samlSessionId.length > 0
			? `?${SAML_SESSION_QUERY_PARAM}=${encodeURIComponent(samlSessionId)}`
			: '';
	return authFetch<EndUserSessionStatusResponseDto>(`${AUTH_API_PATH}/session${query}`);
}

export async function completeSsoLogin(samlSessionId: string): Promise<string> {
	const response = await fetch(`${AUTH_API_PATH}/login/complete-sso`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ samlSessionId }),
	});

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		// Preserve Retry-After on a 429 so a throttled SSO completion can show the backoff timer,
		// consistent with loginEndUser/authFetch (which already forward it).
		throw new AuthApiError(error.statusCode, error.message, parseRetryAfter(response));
	}

	return response.text();
}
