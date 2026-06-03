import type { AdminDashboardIdpCertStatus } from '@nestidp/shared';
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

export function certStatusLabel(status: AdminDashboardIdpCertStatus | string): string {
	switch (status) {
		case 'ok':
			return 'Certificate OK';
		case 'missing':
			return 'No signing cert';
		case 'expiring_soon':
			return 'Expiring soon';
		case 'rotation_active':
			return 'Rotation in progress';
		default:
			return String(status);
	}
}

export function activeFlagToBadge(active: boolean): BadgeVariant {
	return active ? 'success' : 'danger';
}
