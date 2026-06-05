import { Link } from 'react-router-dom';

export function AdminBreadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
	return (
		<nav className="evg-breadcrumbs" aria-label="Breadcrumb">
			<ol>
				{items.map((item, index) => (
					<li key={`${item.label}-${index}`}>
						{item.to ? <Link to={item.to}>{item.label}</Link> : item.label}
					</li>
				))}
			</ol>
		</nav>
	);
}
