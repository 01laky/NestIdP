export const DEFAULT_ADMIN_PASSWORD = 'changeme';

export const MIN_STRONG_ADMIN_PASSWORD_LENGTH = 12;

export function isWeakAdminPassword(password: string | undefined): boolean {
	if (password === undefined) {
		return true;
	}
	const trimmed = password.trim();
	if (trimmed.length === 0) {
		return true;
	}
	if (trimmed === DEFAULT_ADMIN_PASSWORD) {
		return true;
	}
	if (trimmed.length < MIN_STRONG_ADMIN_PASSWORD_LENGTH) {
		return true;
	}
	return false;
}

export function assertStrongAdminPassword(nodeEnv: string, password: string): void {
	if (nodeEnv !== 'production') {
		return;
	}
	if (isWeakAdminPassword(password)) {
		throw new Error('Password does not meet production strength requirements');
	}
}
