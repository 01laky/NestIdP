import type { ReactNode } from 'react';

export function Breadcrumbs({ children }: { children: ReactNode }) {
	return (
		<nav className="evg-breadcrumbs" aria-label="Breadcrumb">
			{children}
		</nav>
	);
}

export function BreadcrumbList({ items }: { items: Array<{ label: string; to?: string }> }) {
	return (
		<Breadcrumbs>
			<ol>
				{items.map((item) => (
					<li key={item.label}>{item.label}</li>
				))}
			</ol>
		</Breadcrumbs>
	);
}
