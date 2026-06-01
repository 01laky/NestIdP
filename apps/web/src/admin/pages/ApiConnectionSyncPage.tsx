import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	getApiConnection,
	getSyncStatus,
	listSyncLogs,
	triggerIdentitySync,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function ApiConnectionSyncPage() {
	const { id } = useParams<{ id: string }>();
	useDocumentTitle('Identity sync — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connectionName, setConnectionName] = useState('');
	const [status, setStatus] = useState<string>('');
	const [logs, setLogs] = useState<Awaited<ReturnType<typeof listSyncLogs>>['syncLogs']>([]);
	const [dryRun, setDryRun] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function reload() {
		if (!id) {
			return;
		}
		const [conn, syncStatus, syncLogs] = await Promise.all([
			getApiConnection(id),
			getSyncStatus(id),
			listSyncLogs(id, 20),
		]);
		setConnectionName(conn.connection.name);
		setStatus(syncStatus.lastSyncStatus);
		setLogs(syncLogs.syncLogs);
	}

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				await reload();
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load sync data');
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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reload when id changes
	}, [id]);

	async function handleSync(event: FormEvent) {
		event.preventDefault();
		if (!id) {
			return;
		}
		setSyncing(true);
		setMessage(null);
		setError(null);
		try {
			const result = await triggerIdentitySync(id, { dryRun });
			setMessage(
				dryRun ? `Dry run finished (${result.syncLog.id})` : `Sync finished (${result.syncLog.id})`,
			);
			await reload();
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Sync failed');
		} finally {
			setSyncing(false);
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={`Sync — ${connectionName}`}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'API connections', to: API_CONNECTION_ROUTE_PREFIX },
					{ label: connectionName, to: `${API_CONNECTION_ROUTE_PREFIX}/${id}` },
					{ label: 'Sync' },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<p className="muted">Current status: {status}</p>
			<form onSubmit={(event) => void handleSync(event)}>
				<label>
					<input
						type="checkbox"
						checked={dryRun}
						onChange={(event) => setDryRun(event.target.checked)}
					/>{' '}
					Dry run (no DB writes)
				</label>
				<button type="submit" disabled={syncing}>
					{syncing ? 'Running…' : dryRun ? 'Run dry sync' : 'Run full sync'}
				</button>
			</form>
			{message ? <p className="muted">{message}</p> : null}
			<h3>Recent logs</h3>
			{logs.length === 0 ? (
				<p className="muted">No sync logs yet.</p>
			) : (
				<ul className="admin-list">
					{logs.map((log) => (
						<li key={log.id}>
							<Link to={`/admin/sync-logs/${log.id}`}>
								{log.status} — {log.startedAt}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
