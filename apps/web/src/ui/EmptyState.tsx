import type { ReactNode } from 'react';

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="evg-empty">
			<h3>{title}</h3>
			{description ? <p className="evg-muted">{description}</p> : null}
			{action ? <div style={{ marginTop: 'var(--evg-space-4)' }}>{action}</div> : null}
		</div>
	);
}
