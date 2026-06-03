import type { ReactNode } from 'react';

export function Panel({
	title,
	children,
	className = '',
	id,
}: {
	title?: string;
	children: ReactNode;
	className?: string;
	id?: string;
}) {
	return (
		<section className={`evg-panel ${className}`.trim()} id={id}>
			{title ? <h3 className="evg-panel__title">{title}</h3> : null}
			{children}
		</section>
	);
}
