import type { ReactNode } from 'react';

export type BadgeVariant = 'success' | 'danger' | 'info' | 'neutral' | 'warning';

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
	return <span className={`evg-badge evg-badge--${variant}`}>{children}</span>;
}
