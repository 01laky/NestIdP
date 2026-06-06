import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONTRACT_PRESETS,
	type ApiContractConfig,
} from '@nestidp/shared';
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
import {
	Button,
	Callout,
	Panel,
	Select,
	TextArea,
	TextInput,
	useConfirmAction,
	useToast,
} from '../../ui';

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
	const [contractJson, setContractJson] = useState('');
	const [contractTouched, setContractTouched] = useState(false);
	const [saving, setSaving] = useState(false);
	const { showToast } = useToast();

	function parseContract(): ApiContractConfig | null {
		const trimmed = contractJson.trim();
		if (trimmed.length === 0) {
			return null;
		}
		return JSON.parse(trimmed) as ApiContractConfig;
	}

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
					setContractJson(
						data.connection.apiContractConfig
							? JSON.stringify(data.connection.apiContractConfig, null, 2)
							: '',
					);
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
		let apiContractConfig: ApiContractConfig | null;
		try {
			apiContractConfig = parseContract();
		} catch {
			setError(t('contractJsonInvalid'));
			setSaving(false);
			return;
		}
		try {
			if (isNew) {
				const created = await createApiConnection({
					name,
					baseUrl,
					bearerToken,
					...(apiContractConfig ? { apiContractConfig } : {}),
				});
				showToast(t('toastSaved'));
				navigate(`${API_CONNECTION_ROUTE_PREFIX}/${created.connection.id}`);
			} else if (id) {
				await updateApiConnection(id, {
					name,
					baseUrl,
					...(bearerToken ? { bearerToken } : {}),
					...(contractTouched ? { apiContractConfig } : {}),
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
			const parts = [result.message];
			if (result.previewUsersCount !== undefined) {
				parts.push(t('contractPreviewCount', { count: result.previewUsersCount }));
			}
			if (result.contractError) {
				parts.push(t('contractPreviewError', { error: result.contractError }));
			}
			setTestMessage(parts.join(' · '));
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
						<details className="evg-filters-panel evg-filters-panel--collapsible">
							<summary>{t('contractAdvanced')}</summary>
							<div className="evg-stack">
								<Callout variant="info">{t('contractLimitation')}</Callout>
								<Select
									label={t('contractPreset')}
									name="contractPreset"
									value=""
									onChange={(e) => {
										const preset = API_CONTRACT_PRESETS.find((p) => p.id === e.target.value);
										if (!preset) {
											return;
										}
										setContractTouched(true);
										setContractJson(
											Object.keys(preset.config).length === 0
												? ''
												: JSON.stringify(preset.config, null, 2),
										);
									}}
								>
									<option value="">{t('contractPresetChoose')}</option>
									{API_CONTRACT_PRESETS.map((preset) => (
										<option key={preset.id} value={preset.id}>
											{preset.label}
										</option>
									))}
								</Select>
								<TextArea
									label={t('contractJsonLabel')}
									name="apiContractConfig"
									rows={12}
									value={contractJson}
									placeholder='{ "endpoints": { "usersPath": "/users" } }'
									hint={t('contractJsonHint')}
									onChange={(e) => {
										setContractTouched(true);
										setContractJson(e.target.value);
									}}
								/>
								<Button
									type="button"
									variant="link"
									onClick={() => {
										setContractTouched(true);
										setContractJson('');
									}}
								>
									{t('contractReset')}
								</Button>
							</div>
						</details>
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
