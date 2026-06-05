import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	createApiConnection,
	deleteApiConnection,
	getApiConnection,
	testApiConnection,
	updateApiConnection,
} from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, Panel, TextInput, useConfirmAction, useToast } from '../../ui';

export function ApiConnectionFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { t } = useTranslation('apiConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const confirmAction = useConfirmAction();
	useAdminDocumentTitle(isNew ? t('formNew') : t('formEdit'));
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
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'apiConnections.loadFailed',
								)
							: t('loadFailed'),
					);
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
	}, [id, isNew, t]);

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
				showToast(t('toastSaved'));
				navigate(`${API_CONNECTION_ROUTE_PREFIX}/${created.connection.id}`);
			} else if (id) {
				await updateApiConnection(id, {
					name,
					baseUrl,
					...(bearerToken ? { bearerToken } : {}),
				});
				showToast(t('toastSaved'));
			}
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'apiConnections.saveFailed',
						)
					: t('saveFailed'),
			);
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
			setTestMessage(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'apiConnections.testFailed',
						)
					: t('testFailed'),
			);
		}
	}

	async function handleDelete() {
		if (!id) {
			return;
		}
		await confirmAction({
			title: t('confirmDeleteTitle'),
			description: t('confirmDelete'),
			tone: 'danger',
			showAuditNote: true,
			confirmLabel: tCommon('delete'),
			onConfirm: async () => {
				try {
					await deleteApiConnection(id);
					navigate(API_CONNECTION_ROUTE_PREFIX);
				} catch (err) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'apiConnections.deleteFailed',
								)
							: t('deleteFailed'),
					);
				}
			},
		});
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? t('formNew') : t('formEdit')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: t('listTitle'), to: API_CONNECTION_ROUTE_PREFIX },
					{ label: isNew ? tCommon('new') : name || id! },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<Panel title={t('connectionDetails')}>
				<form
					className="evg-stack"
					aria-busy={saving}
					onSubmit={(event) => void handleSubmit(event)}
				>
					<fieldset className="evg-stack" disabled={saving}>
						<TextInput
							label={tCommon('name')}
							name="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							requiredMark={isNew}
						/>
						<TextInput
							label={tCommon('baseUrl')}
							name="baseUrl"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							required
							requiredMark={isNew}
						/>
						<TextInput
							label={isNew ? t('bearerToken') : t('bearerTokenKeep')}
							name="bearerToken"
							type="password"
							value={bearerToken}
							onChange={(e) => setBearerToken(e.target.value)}
							required={isNew}
							requiredMark={isNew}
						/>
						<Button type="submit" variant="primary" disabled={saving}>
							{saving ? tCommon('saving') : tCommon('save')}
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
						{t('testConnectivity')}
					</Button>
					<Button
						type="button"
						variant="danger"
						disabled={saving}
						onClick={() => void handleDelete()}
					>
						{tCommon('delete')}
					</Button>
					{testMessage ? <span className="evg-muted"> — {testMessage}</span> : null}
				</div>
			) : null}
			<p>
				<Link className="evg-btn evg-btn--link" to={API_CONNECTION_ROUTE_PREFIX}>
					{t('backToList')}
				</Link>
			</p>
		</section>
	);
}
