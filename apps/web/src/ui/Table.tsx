import type { ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
	return (
		<div className="evg-table-wrap" data-testid="evg-table-wrap">
			<table className="evg-table">{children}</table>
		</div>
	);
}
