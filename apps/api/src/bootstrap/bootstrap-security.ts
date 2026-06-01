export const DEFAULT_ADMIN_PASSWORD = 'changeme';

const MIN_STRONG_PASSWORD_LENGTH = 12;

export function isWeakBootstrapPassword(password: string | undefined): boolean {
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
	if (trimmed.length < MIN_STRONG_PASSWORD_LENGTH) {
		return true;
	}
	return false;
}

export function assertProductionBootstrapPassword(
	nodeEnv: string,
	adminPassword: string | undefined,
	adminUserCount: number,
): void {
	if (nodeEnv !== 'production' || adminUserCount > 0) {
		return;
	}

	if (!adminPassword?.trim()) {
		throw new Error(
			'Bootstrap: refuse to create initial admin in production without ADMIN_PASSWORD',
		);
	}

	if (isWeakBootstrapPassword(adminPassword)) {
		throw new Error(
			'Bootstrap: refuse to create initial admin in production with default or weak ADMIN_PASSWORD',
		);
	}
}

export function normalizeBootstrapCredential(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
