import type { ReactNode } from 'react';
import { AdminBreadcrumbs, type BreadcrumbItem } from './AdminBreadcrumbs';

type AdminPageHeaderProps = {
	title: string;
	subtitle?: string;
	breadcrumbs?: BreadcrumbItem[];
	actions?: ReactNode;
};

export function AdminPageHeader({ title, subtitle, breadcrumbs, actions }: AdminPageHeaderProps) {
	return (
		<header className="admin-page-header">
			{breadcrumbs && breadcrumbs.length > 0 ? <AdminBreadcrumbs items={breadcrumbs} /> : null}
			<div className="admin-page-header-row">
				<div>
					<h2>{title}</h2>
					{subtitle ? <p className="muted">{subtitle}</p> : null}
				</div>
				{actions ? <div className="admin-page-actions">{actions}</div> : null}
			</div>
		</header>
	);
}
