import type {
	AdminLoginRequestDto,
	AdminLoginResponseDto,
	AdminLogoutResponseDto,
	AdminMeResponseDto,
	ApiErrorResponseDto,
} from '@nestidp/shared';

export class AdminApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'AdminApiError';
	}
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
	const response = await fetch(path, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});

	if (!response.ok) {
		const error = await parseErrorResponse(response);
		throw new AdminApiError(error.statusCode, error.message);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

export function loginAdmin(body: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
	return adminFetch<AdminLoginResponseDto>('/api/admin/auth/login', {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function logoutAdmin(): Promise<AdminLogoutResponseDto> {
	return adminFetch<AdminLogoutResponseDto>('/api/admin/auth/logout', {
		method: 'POST',
	});
}

export function getAdminMe(): Promise<AdminMeResponseDto> {
	return adminFetch<AdminMeResponseDto>('/api/admin/auth/me');
}
