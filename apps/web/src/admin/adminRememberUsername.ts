import { ADMIN_REMEMBER_USERNAME_STORAGE_KEY } from '@nestidp/shared';

const MAX_USERNAME_LENGTH = 255;

export function readRememberedAdminUsername(): string | null {
	try {
		const value = localStorage.getItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY);
		if (!value) {
			return null;
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

export function writeRememberedAdminUsername(username: string): void {
	const trimmed = username.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_USERNAME_LENGTH) {
		return;
	}
	try {
		localStorage.setItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY, trimmed);
	} catch {
		// private mode / disabled storage
	}
}

export function clearRememberedAdminUsername(): void {
	try {
		localStorage.removeItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY);
	} catch {
		// ignore
	}
}
