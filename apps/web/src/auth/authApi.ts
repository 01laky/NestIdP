import type {
	CompleteSsoNotImplementedResponseDto,
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
	) {
		super(message);
		this.name = 'AuthApiError';
	}
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
		throw new AuthApiError(error.statusCode, error.message);
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

export async function completeSsoLogin(
	samlSessionId: string,
): Promise<CompleteSsoNotImplementedResponseDto> {
	const response = await fetch(`${AUTH_API_PATH}/login/complete-sso`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ samlSessionId }),
	});

	// Prompt 07 stub — 501 is the expected success shape for this endpoint
	if (response.status === 501) {
		return (await response.json()) as CompleteSsoNotImplementedResponseDto;
	}

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		throw new AuthApiError(error.statusCode, error.message);
	}

	return (await response.json()) as CompleteSsoNotImplementedResponseDto;
}
