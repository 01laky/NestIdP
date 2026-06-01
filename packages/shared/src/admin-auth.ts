export const ADMIN_SESSION_COOKIE_NAME = 'nestidp_admin_session';

export const ADMIN_CSRF_HEADER_NAME = 'X-CSRF-Token';

export interface AdminLoginRequestDto {
	username: string;
	password: string;
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
