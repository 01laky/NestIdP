export const ADMIN_SESSION_COOKIE_NAME = 'nestidp_admin_session';

export const ADMIN_CSRF_HEADER_NAME = 'X-CSRF-Token';

/** Browser localStorage key — username only, never password. */
export const ADMIN_REMEMBER_USERNAME_STORAGE_KEY = 'nestidp_admin_remember_username' as const;

/** Default short session when rememberMe is false or omitted. */
export const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 28_800 as const;

/** Default long session when rememberMe is true. */
export const DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS = 2_592_000 as const;

/** Hard cap for remember TTL (env + payload) — 90 days. */
export const MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS = 7_776_000 as const;

export interface AdminLoginRequestDto {
	username: string;
	password: string;
	/** When true, API issues a longer-lived persistent session cookie. Default false. */
	rememberMe?: boolean;
}

export interface AdminMeDto {
	id: string;
	username: string;
}

export interface AdminLoginResponseDto {
	ok: true;
	admin: AdminMeDto;
	csrfToken: string;
}

export interface AdminLogoutResponseDto {
	ok: true;
}

export interface AdminMeResponseDto {
	admin: AdminMeDto;
	csrfToken: string;
}

export interface AdminChangePasswordRequestDto {
	currentPassword: string;
	newPassword: string;
}

export interface AdminChangePasswordResponseDto {
	ok: true;
}
