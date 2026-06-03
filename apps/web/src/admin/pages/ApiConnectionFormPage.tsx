import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	createApiConnection,
	deleteApiConnection,
	getApiConnection,
	testApiConnection,
	updateApiConnection,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useToast } from '../../ui';

export function ApiConnectionFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	useDocumentTitle(
		isNew ? 'New API connection — NestIdP Admin' : 'Edit API connection — NestIdP Admin',
	);

	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [bearerToken, setBearerToken] = useState('');
	const [testMessage, setTestMessage] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const { showToast } = useToast();

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getApiConnection(id);
				if (!cancelled) {
					setName(data.connection.name);
					setBaseUrl(data.connection.baseUrl);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load connection');
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
	}, [id, isNew]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			if (isNew) {
				const created = await createApiConnection({
					name,
					baseUrl,
					bearerToken,
				});
				showToast('Connection saved');
				navigate(`${API_CONNECTION_ROUTE_PREFIX}/${created.connection.id}`);
			} else if (id) {
				await updateApiConnection(id, {
					name,
					baseUrl,
					...(bearerToken ? { bearerToken } : {}),
				});
				showToast('Connection saved');
			}
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	}

	async function handleTest() {
		if (!id) {
			return;
		}
		setTestMessage(null);
		try {
			const result = await testApiConnection(id);
			setTestMessage(result.message);
		} catch (err) {
			setTestMessage(err instanceof AdminApiError ? err.message : 'Test failed');
		}
	}

	async function handleDelete() {
		if (!id) {
			return;
		}
		if (!window.confirm('Delete this API connection?')) {
			return;
		}
		try {
			await deleteApiConnection(id);
			navigate(API_CONNECTION_ROUTE_PREFIX);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Delete failed');
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? 'New API connection' : 'Edit API connection'}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'API connections', to: API_CONNECTION_ROUTE_PREFIX },
					{ label: isNew ? 'New' : name || id! },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form onSubmit={(event) => void handleSubmit(event)}>
				<label>
					Name
					<input value={name} onChange={(e) => setName(e.target.value)} required />
				</label>
				<label>
					Base URL
					<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
				</label>
				<label>
					Bearer token {isNew ? '' : '(leave blank to keep)'}
					<input
						type="password"
						value={bearerToken}
						onChange={(e) => setBearerToken(e.target.value)}
						required={isNew}
					/>
				</label>
				<button type="submit" disabled={saving}>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</form>
			{!isNew && id ? (
				<p>
					<button type="button" onClick={() => void handleTest()}>
						Test connectivity
					</button>{' '}
					<button
						type="button"
						className="evg-btn evg-btn--danger"
						onClick={() => void handleDelete()}
					>
						Delete
					</button>
					{testMessage ? <span className="evg-muted"> — {testMessage}</span> : null}
				</p>
			) : null}
			<p>
				<Link to={API_CONNECTION_ROUTE_PREFIX}>Back to list</Link>
			</p>
		</section>
	);
}
