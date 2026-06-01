import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getSyncLog } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function SyncLogDetailPage() {
	const { syncLogId } = useParams<{ syncLogId: string }>();
	useDocumentTitle('Sync log — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [log, setLog] = useState<Awaited<ReturnType<typeof getSyncLog>>['syncLog'] | null>(null);

	useEffect(() => {
		if (!syncLogId) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getSyncLog(syncLogId);
				if (!cancelled) {
					setLog(data.syncLog);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load sync log');
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [syncLogId]);

	if (loading) {
		return <LoadingState />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!log) {
		return <ErrorBanner message="Sync log not found" />;
	}

	return (
		<section>
			<AdminPageHeader
				title="Sync log detail"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'API connections', to: API_CONNECTION_ROUTE_PREFIX },
					{ label: log.id },
				]}
			/>
			<ul className="admin-kv-list">
				<li>
					<span>Status</span>
					<strong>{log.status}</strong>
				</li>
				<li>
					<span>Started</span>
					<code>{log.startedAt}</code>
				</li>
				<li>
					<span>Finished</span>
					<code>{log.finishedAt ?? '—'}</code>
				</li>
				<li>
					<span>Dry run</span>
					<code>{String(log.dryRun)}</code>
				</li>
			</ul>
			{log.errors && log.errors.length > 0 ? (
				<pre className="admin-pre">{JSON.stringify(log.errors, null, 2)}</pre>
			) : (
				<p className="muted">No errors recorded.</p>
			)}
			<p>
				<Link to={API_CONNECTION_ROUTE_PREFIX}>Back to API connections</Link>
			</p>
		</section>
	);
}
