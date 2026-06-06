import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONTRACT_PRESETS,
	type ApiContractConfig,
	type AuthType,
	OAUTH_CLIENT_AUTH_METHODS,
	type OAuthClientAuthMethod,
} from '@nestidp/shared';
import {
	AdminApiError,
	createApiConnection,
	deleteApiConnection,
	getApiConnection,
	testApiConnection,
	testApiConnectionToken,
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
	const [authType, setAuthType] = useState<AuthType>('BEARER');
	const [bearerToken, setBearerToken] = useState('');
	// OAuth fields
	const [oauthTokenUrl, setOauthTokenUrl] = useState('');
	const [oauthClientId, setOauthClientId] = useState('');
	const [oauthClientSecret, setOauthClientSecret] = useState('');
	const [oauthScope, setOauthScope] = useState('');
	const [oauthAudience, setOauthAudience] = useState('');
	const [oauthClientAuthMethod, setOauthClientAuthMethod] =
		useState<OAuthClientAuthMethod>('client_secret_post');
	const [oauthTokenParamsJson, setOauthTokenParamsJson] = useState('');
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

	function parseTokenParams(): Record<string, string> | null {
		const trimmed = oauthTokenParamsJson.trim();
		if (trimmed.length === 0) {
			return null;
		}
		return JSON.parse(trimmed) as Record<string, string>;
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
					const c = data.connection;
					setName(c.name);
					setBaseUrl(c.baseUrl);
					setAuthType(c.authType);
					setOauthTokenUrl(c.oauthTokenUrl ?? '');
					setOauthClientId(c.oauthClientId ?? '');
					setOauthScope(c.oauthScope ?? '');
					setOauthAudience(c.oauthAudience ?? '');
					setOauthClientAuthMethod(c.oauthClientAuthMethod ?? 'client_secret_post');
					setOauthTokenParamsJson(
						c.oauthTokenRequestParams ? JSON.stringify(c.oauthTokenRequestParams, null, 2) : '',
					);
					setContractJson(c.apiContractConfig ? JSON.stringify(c.apiContractConfig, null, 2) : '');
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
		let oauthTokenRequestParams: Record<string, string> | null;
		try {
			oauthTokenRequestParams = parseTokenParams();
		} catch {
			setError(t('oauthTokenParamsInvalid'));
			setSaving(false);
			return;
		}

		const oauthFields =
			authType === 'OAUTH2_CLIENT_CREDENTIALS'
				? {
						oauthTokenUrl,
						oauthClientId,
						oauthScope: oauthScope || null,
						oauthAudience: oauthAudience || null,
						oauthClientAuthMethod,
						oauthTokenRequestParams,
						...(oauthClientSecret ? { oauthClientSecret } : {}),
					}
				: {};

		try {
			if (isNew) {
				const created = await createApiConnection({
					name,
					baseUrl,
					authType,
					...(authType === 'BEARER' ? { bearerToken } : {}),
					...oauthFields,
					...(apiContractConfig ? { apiContractConfig } : {}),
				});
				showToast(t('toastSaved'));
				navigate(`${API_CONNECTION_ROUTE_PREFIX}/${created.connection.id}`);
			} else if (id) {
				await updateApiConnection(id, {
					name,
					baseUrl,
					authType,
					...(authType === 'BEARER' && bearerToken ? { bearerToken } : {}),
					...oauthFields,
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

	async function handleTestToken() {
		if (!id) {
			return;
		}
		setTestMessage(null);
		try {
			const result = await testApiConnectionToken(id);
			if (result.ok) {
				setTestMessage(
					t('tokenOk', {
						tokenType: result.tokenType ?? 'Bearer',
						expiresIn: result.expiresIn ?? '?',
					}),
				);
			} else {
				setTestMessage(t('tokenError', { error: result.error ?? 'failed' }));
			}
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

	const isOauth = authType === 'OAUTH2_CLIENT_CREDENTIALS';

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
						<Select
							label={t('authType')}
							name="authType"
							value={authType}
							onChange={(e) => setAuthType(e.target.value as AuthType)}
						>
							<option value="BEARER">{t('authTypeBearer')}</option>
							<option value="OAUTH2_CLIENT_CREDENTIALS">{t('authTypeOauth')}</option>
						</Select>

						{!isOauth ? (
							<TextInput
								label={isNew ? t('bearerToken') : t('bearerTokenKeep')}
								name="bearerToken"
								type="password"
								value={bearerToken}
								onChange={(e) => setBearerToken(e.target.value)}
								required={isNew}
								requiredMark={isNew}
							/>
						) : (
							<div className="evg-stack">
								<Callout variant="info">{t('oauthSection')}</Callout>
								<TextInput
									label={t('oauthTokenUrl')}
									name="oauthTokenUrl"
									value={oauthTokenUrl}
									onChange={(e) => setOauthTokenUrl(e.target.value)}
									required={isNew}
								/>
								<TextInput
									label={t('oauthClientId')}
									name="oauthClientId"
									value={oauthClientId}
									onChange={(e) => setOauthClientId(e.target.value)}
									required={isNew}
								/>
								<TextInput
									label={isNew ? t('oauthClientSecret') : t('oauthClientSecretKeep')}
									name="oauthClientSecret"
									type="password"
									value={oauthClientSecret}
									onChange={(e) => setOauthClientSecret(e.target.value)}
									required={isNew}
								/>
								<Select
									label={t('oauthClientAuthMethod')}
									name="oauthClientAuthMethod"
									value={oauthClientAuthMethod}
									onChange={(e) =>
										setOauthClientAuthMethod(e.target.value as OAuthClientAuthMethod)
									}
								>
									{OAUTH_CLIENT_AUTH_METHODS.map((m) => (
										<option key={m.id} value={m.id}>
											{m.id === 'client_secret_post'
												? t('oauthAuthMethodPost')
												: t('oauthAuthMethodBasic')}
										</option>
									))}
								</Select>
								<TextInput
									label={t('oauthScope')}
									name="oauthScope"
									value={oauthScope}
									onChange={(e) => setOauthScope(e.target.value)}
								/>
								<TextInput
									label={t('oauthAudience')}
									name="oauthAudience"
									value={oauthAudience}
									onChange={(e) => setOauthAudience(e.target.value)}
								/>
								<TextArea
									label={t('oauthTokenParams')}
									name="oauthTokenRequestParams"
									rows={4}
									value={oauthTokenParamsJson}
									placeholder='{ "resource": "https://api.example.com" }'
									hint={t('oauthTokenParamsHint')}
									onChange={(e) => setOauthTokenParamsJson(e.target.value)}
								/>
							</div>
						)}

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
					{isOauth ? (
						<Button
							type="button"
							variant="secondary"
							disabled={saving}
							onClick={() => void handleTestToken()}
						>
							{t('testToken')}
						</Button>
					) : null}
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
