import type { ReactNode } from 'react';

type EmptyStateProps = {
	title: string;
	description?: string;
	action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
	return (
		<div className="admin-empty">
			<h3>{title}</h3>
			{description ? <p className="muted">{description}</p> : null}
			{action}
		</div>
	);
}
