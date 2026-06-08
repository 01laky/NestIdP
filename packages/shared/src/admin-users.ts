export const ADMIN_USERS_API_PATH = '/api/admin/admin-users';

export const ADMIN_USERS_ROUTE_PREFIX = '/admin/settings/admins';

/** Non-secret brute-force lockout status for an account (Prompt 35). No hashes/tokens. */
export interface AccountLockoutStatusDto {
	locked: boolean;
	lockedUntil: string | null;
	failedCount: number;
	lastFailedAt: string | null;
}

export interface AdminUserPublicDto {
	id: string;
	username: string;
	createdAt: string;
	updatedAt: string;
	/** Brute-force lockout status (Prompt 35); present on list/detail responses. */
	lockout?: AccountLockoutStatusDto;
}

export interface UnlockAccountResponseDto {
	ok: true;
	id: string;
}

export interface CreateAdminUserRequestDto {
	username: string;
	password: string;
}

export interface UpdateAdminUserRequestDto {
	password: string;
}

export interface DeleteAdminUserResponseDto {
	ok: true;
	id: string;
}
