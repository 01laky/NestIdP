import { Link } from 'react-router-dom';

export type BreadcrumbItem = {
	label: string;
	to?: string;
};

type AdminBreadcrumbsProps = {
	items: BreadcrumbItem[];
};

export function AdminBreadcrumbs({ items }: AdminBreadcrumbsProps) {
	return (
		<nav className="admin-breadcrumbs" aria-label="Breadcrumb">
			<ol>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					return (
						<li key={`${item.label}-${index}`}>
							{!isLast && item.to ? (
								<Link to={item.to}>{item.label}</Link>
							) : (
								<span>{item.label}</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
