import type { ReactNode } from 'react';
import { PageHeader } from '../../ui';
import { AdminBreadcrumbs } from './AdminBreadcrumbs';

export function AdminPageHeader({
	title,
	subtitle,
	breadcrumbs,
	actions,
}: {
	title: string;
	subtitle?: string;
	breadcrumbs?: Array<{ label: string; to?: string }>;
	actions?: ReactNode;
}) {
	return (
		<PageHeader
			title={title}
			subtitle={subtitle}
			actions={actions}
			breadcrumbs={
				breadcrumbs && breadcrumbs.length > 0 ? <AdminBreadcrumbs items={breadcrumbs} /> : undefined
			}
		/>
	);
}
