import type { ReactNode } from 'react';
import { Breadcrumbs } from './Breadcrumbs';

export function PageHeader({
	title,
	subtitle,
	breadcrumbs,
	actions,
}: {
	title: string;
	subtitle?: string;
	breadcrumbs?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="evg-page-header">
			{breadcrumbs ? <Breadcrumbs>{breadcrumbs}</Breadcrumbs> : null}
			<div className="evg-page-header__row">
				<div>
					<h2 className="evg-page-header__title">{title}</h2>
					{subtitle ? <p className="evg-muted">{subtitle}</p> : null}
				</div>
				{actions ? <div className="evg-cluster">{actions}</div> : null}
			</div>
		</header>
	);
}
