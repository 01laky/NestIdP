import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUDIT_CATEGORIES } from '@nestidp/shared';
import { AdminApiError, auditExportUrl, getCsrfToken, listAuditEvents } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function AuditLogPage() {
	useDocumentTitle('Audit log — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [category, setCategory] = useState('');
	const [event, setEvent] = useState('');
	const [data, setData] = useState<Awaited<ReturnType<typeof listAuditEvents>> | null>(null);

	async function load() {
		setLoading(true);
		setError(null);
		const params: Record<string, string> = { limit: '50', offset: '0' };
		if (category) {
			params.category = category;
		}
		if (event.trim()) {
			params.event = event.trim();
		}
		const result = await listAuditEvents(params);
		setData(result);
		setLoading(false);
	}

	useEffect(() => {
		void load().catch((err) => {
			setError(err instanceof AdminApiError ? err.message : 'Failed to load audit log');
			setLoading(false);
		});
		// Initial load only; Filter button calls load() explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function download(format: 'json' | 'csv') {
		const params: Record<string, string> = { format };
		if (category) {
			params.category = category;
		}
		if (event.trim()) {
			params.event = event.trim();
		}
		window.open(auditExportUrl(params), '_blank');
	}

	return (
		<section>
			<AdminPageHeader
				title="Audit log"
				subtitle="Security and configuration events (sync details remain in Sync logs)"
				breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Audit log' }]}
				actions={
					<>
						<button type="button" className="button-link" onClick={() => download('csv')}>
							Export CSV
						</button>
						<button type="button" className="button-link" onClick={() => download('json')}>
							Export JSON
						</button>
					</>
				}
			/>
			<form
				className="admin-form inline"
				onSubmit={(e) => {
					e.preventDefault();
					void load();
				}}
			>
				<label>
					Category
					<select value={category} onChange={(e) => setCategory(e.target.value)}>
						<option value="">All</option>
						{AUDIT_CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
				</label>
				<label>
					Event
					<input
						value={event}
						onChange={(e) => setEvent(e.target.value)}
						placeholder="exact name"
					/>
				</label>
				<button type="submit">Filter</button>
			</form>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{data && !loading ? (
				<>
					<p className="muted">
						Showing {data.items.length} of {data.total} events
					</p>
					<table className="admin-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>Category</th>
								<th>Event</th>
								<th>Actor</th>
								<th>Subject</th>
							</tr>
						</thead>
						<tbody>
							{data.items.map((row) => (
								<tr key={row.id}>
									<td className="muted">{new Date(row.createdAt).toLocaleString()}</td>
									<td>{row.category}</td>
									<td>{row.event}</td>
									<td>{row.actorLabel ?? row.actorType}</td>
									<td>
										{row.subjectType ? `${row.subjectType}:${row.subjectId ?? ''}` : '—'}
										{row.metadata &&
										typeof row.metadata === 'object' &&
										'syncLogId' in row.metadata &&
										typeof row.metadata.syncLogId === 'string' ? (
											<>
												{' '}
												<Link to={`/admin/sync-logs/${row.metadata.syncLogId}`}>Sync log</Link>
											</>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			) : null}
			{getCsrfToken() ? null : null}
		</section>
	);
}
