export const ADMIN_SESSION_COOKIE_NAME = 'nestidp_admin_session';

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
}

export interface AdminLogoutResponseDto {
	ok: true;
}

export interface AdminMeResponseDto {
	admin: AdminMeDto;
}
