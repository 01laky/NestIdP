import type {
	AdminDashboardEncryptionCertStatus,
	AdminDashboardIdpCertStatus,
} from '@nestidp/shared';
import { resolveI18nKey } from '../i18n/api-error-messages';
import type { BadgeVariant } from '../ui/Badge';

export type { BadgeVariant };

export function syncLogStatusToBadge(status: string): BadgeVariant {
	switch (status) {
		case 'SUCCESS':
			return 'success';
		case 'FAILED':
			return 'danger';
		case 'RUNNING':
			return 'info';
		default:
			return 'neutral';
	}
}

export function lastSyncStatusToBadge(status: string): BadgeVariant {
	switch (status) {
		case 'SUCCESS':
			return 'success';
		case 'FAILED':
			return 'danger';
		case 'IN_PROGRESS':
			return 'info';
		case 'NEVER':
			return 'neutral';
		default:
			return 'neutral';
	}
}

export function certStatusToBadge(status: AdminDashboardIdpCertStatus | string): BadgeVariant {
	switch (status) {
		case 'ok':
			return 'success';
		case 'missing':
			return 'danger';
		case 'expiring_soon':
			return 'warning';
		case 'rotation_active':
			return 'info';
		default:
			return 'neutral';
	}
}

const KNOWN_CERT_STATUSES = new Set<AdminDashboardIdpCertStatus | string>([
	'ok',
	'missing',
	'expiring_soon',
	'rotation_active',
]);

export function certStatusLabel(status: AdminDashboardIdpCertStatus | string): string {
	if (!KNOWN_CERT_STATUSES.has(status)) {
		return String(status);
	}
	return resolveI18nKey(`enums.certStatus.${status}`);
}

const KNOWN_ENCRYPTION_CERT_STATUSES = new Set<AdminDashboardEncryptionCertStatus | string>([
	'ok',
	'missing',
	'not_configured',
	'expiring_soon',
	'rotation_active',
]);

export function encryptionCertStatusToBadge(
	status: AdminDashboardEncryptionCertStatus | string,
): BadgeVariant {
	switch (status) {
		case 'ok':
			return 'success';
		case 'missing':
			return 'danger';
		case 'not_configured':
			return 'neutral';
		case 'expiring_soon':
			return 'warning';
		case 'rotation_active':
			return 'info';
		default:
			return 'neutral';
	}
}

export function encryptionCertStatusLabel(
	status: AdminDashboardEncryptionCertStatus | string,
): string {
	if (!KNOWN_ENCRYPTION_CERT_STATUSES.has(status)) {
		return String(status);
	}
	return resolveI18nKey(`enums.encryptionCertStatus.${status}`);
}

export function activeFlagToBadge(active: boolean): BadgeVariant {
	return active ? 'success' : 'danger';
}

export function identityOriginToBadge(origin: 'manual' | 'synced'): BadgeVariant {
	return origin === 'manual' ? 'info' : 'neutral';
}

export function identityOriginLabel(origin: 'manual' | 'synced'): string {
	return resolveI18nKey(`enums.identityOrigin.${origin}`);
}
