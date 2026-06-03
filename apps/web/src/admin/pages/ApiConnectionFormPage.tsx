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
import { Button, Panel, TextInput, useToast } from '../../ui';

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
			<Panel title="Connection details">
				<form
					className="evg-stack"
					aria-busy={saving}
					onSubmit={(event) => void handleSubmit(event)}
				>
					<fieldset className="evg-stack" disabled={saving}>
						<TextInput
							label="Name"
							name="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							requiredMark={isNew}
						/>
						<TextInput
							label="Base URL"
							name="baseUrl"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							required
							requiredMark={isNew}
						/>
						<TextInput
							label={isNew ? 'Bearer token' : 'Bearer token (leave blank to keep)'}
							name="bearerToken"
							type="password"
							value={bearerToken}
							onChange={(e) => setBearerToken(e.target.value)}
							required={isNew}
							requiredMark={isNew}
						/>
						<Button type="submit" variant="primary" disabled={saving}>
							{saving ? 'Saving…' : 'Save'}
						</Button>
					</fieldset>
				</form>
			</Panel>
			{!isNew && id ? (
				<div className="evg-cluster">
					<Button
						type="button"
						variant="secondary"
						disabled={saving}
						onClick={() => void handleTest()}
					>
						Test connectivity
					</Button>
					<Button
						type="button"
						variant="danger"
						disabled={saving}
						onClick={() => void handleDelete()}
					>
						Delete
					</Button>
					{testMessage ? <span className="evg-muted"> — {testMessage}</span> : null}
				</div>
			) : null}
			<p>
				<Link className="evg-btn evg-btn--link" to={API_CONNECTION_ROUTE_PREFIX}>
					Back to list
				</Link>
			</p>
		</section>
	);
}
