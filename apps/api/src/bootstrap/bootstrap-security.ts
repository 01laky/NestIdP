import { DEFAULT_ADMIN_PASSWORD, isWeakAdminPassword } from '@nestidp/shared';

export { DEFAULT_ADMIN_PASSWORD };

export function isWeakBootstrapPassword(password: string | undefined): boolean {
	return isWeakAdminPassword(password);
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
