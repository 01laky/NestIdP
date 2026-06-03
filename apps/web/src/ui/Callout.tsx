import type { ReactNode } from 'react';

export type CalloutVariant = 'info' | 'warning' | 'danger' | 'success';

export function Callout({
	variant,
	children,
	role,
}: {
	variant: CalloutVariant;
	children: ReactNode;
	role?: 'status' | 'alert';
}) {
	const resolvedRole = role ?? (variant === 'danger' ? 'alert' : 'status');
	return (
		<div className={`evg-callout evg-callout--${variant}`} role={resolvedRole}>
			{children}
		</div>
	);
}
