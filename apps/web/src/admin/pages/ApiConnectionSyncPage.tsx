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
import { Button, Checkbox, Panel, useToast } from '../../ui';

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
	const { showToast } = useToast();

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
			showToast(dryRun ? 'Dry run finished' : 'Sync finished');
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
			<p className="evg-muted">Current status: {status}</p>
			<Panel title="Run sync">
				<form
					className="evg-stack"
					aria-busy={syncing}
					onSubmit={(event) => void handleSync(event)}
				>
					<fieldset className="evg-stack" disabled={syncing}>
						<Checkbox label="Dry run (no DB writes)" checked={dryRun} onChange={setDryRun} />
						<Button type="submit" variant="primary" disabled={syncing}>
							{syncing ? 'Running…' : dryRun ? 'Run dry sync' : 'Run full sync'}
						</Button>
					</fieldset>
				</form>
			</Panel>
			{message ? <p className="evg-muted">{message}</p> : null}
			<h3>Recent logs</h3>
			{logs.length === 0 ? (
				<p className="evg-muted">No sync logs yet.</p>
			) : (
				<ul className="evg-list">
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
