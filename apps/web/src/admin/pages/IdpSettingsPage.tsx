import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { IdpSettingsPublicDto } from '@nestidp/shared';
import {
	IDP_ROTATION_STALE_WARNING_DAYS,
	IDP_CERT_EXPIRY_WARNING_DAYS,
	SAML_NAME_ID_FORMATS,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import {
	AdminApiError,
	cancelIdpCertRotation,
	completeIdpCertRotation,
	generateIdpSigningCert,
	getIdpMetadataPreview,
	getIdpSettings,
	startIdpCertRotation,
	updateIdpSettings,
	uploadIdpSigningCert,
} from '../adminApi';
import { AdminBreadcrumbs } from '../components/AdminBreadcrumbs';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import {
	Button,
	CodeBlock,
	Panel,
	Select,
	TextArea,
	TextInput,
	useConfirm,
	useToast,
} from '../../ui';

function isExpiringSoon(notAfter: string | null): boolean {
	if (!notAfter) {
		return false;
	}
	const expiry = new Date(notAfter).getTime();
	if (Number.isNaN(expiry)) {
		return false;
	}
	const threshold = Date.now() + IDP_CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
	return expiry <= threshold;
}

function isStaleRotation(startedAt: string | null): boolean {
	if (!startedAt) {
		return false;
	}
	const started = new Date(startedAt).getTime();
	if (Number.isNaN(started)) {
		return false;
	}
	const threshold = Date.now() - IDP_ROTATION_STALE_WARNING_DAYS * 24 * 60 * 60 * 1000;
	return started <= threshold;
}

function certStatusKey(settings: IdpSettingsPublicDto): string {
	if (settings.rotation.active) {
		return 'certStatusRotation';
	}
	if (!settings.hasSigningCertificate) {
		return 'certStatusMissing';
	}
	if (isExpiringSoon(settings.signingCertNotAfter)) {
		return 'certStatusExpiresSoon';
	}
	return 'certStatusOk';
}

export function IdpSettingsPage() {
	const { t } = useTranslation('idpSettings');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const confirm = useConfirm();
	const { showToast } = useToast();
	useAdminDocumentTitle(t('title'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [settings, setSettings] = useState<IdpSettingsPublicDto | null>(null);
	const [entityId, setEntityId] = useState('');
	const [nameIdFormat, setNameIdFormat] = useState('');
	const [metadataPreview, setMetadataPreview] = useState<string | null>(null);
	const [showUpload, setShowUpload] = useState(false);
	const [uploadCert, setUploadCert] = useState('');
	const [uploadKey, setUploadKey] = useState('');
	const [busy, setBusy] = useState(false);

	async function reload(): Promise<IdpSettingsPublicDto> {
		const data = await getIdpSettings();
		setSettings(data);
		setEntityId(data.entityId);
		setNameIdFormat(data.nameIdFormat);
		return data;
	}

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await reload();
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'idpSettings.loadFailed',
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
	}, [t]);

	async function runMutation(action: () => Promise<void>): Promise<void> {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			await action();
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'idpSettings.requestFailed',
						)
					: t('requestFailed'),
			);
		} finally {
			setBusy(false);
		}
	}

	async function handleSaveEntityId(event: FormEvent) {
		event.preventDefault();
		await runMutation(async () => {
			await updateIdpSettings({ entityId });
			await reload();
			setSuccess(t('successEntityIdUpdated'));
			showToast(t('toastEntityIdUpdated'));
		});
	}

	async function handleSaveNameIdFormat(event: FormEvent) {
		event.preventDefault();
		await runMutation(async () => {
			await updateIdpSettings({ nameIdFormat });
			await reload();
			setSuccess(t('successNameIdUpdated'));
			showToast(t('toastNameIdUpdated'));
		});
	}

	async function copyText(_label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			showToast(tCommon('copyFailed'));
		}
	}

	async function handleGeneratePrimary() {
		const ok = await confirm({
			title: t('confirmGeneratePrimaryTitle'),
			description: t('confirmGeneratePrimary'),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t('generateCertificate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await generateIdpSigningCert();
			await reload();
			setSuccess(t('successPrimaryGenerated'));
			showToast(t('toastPrimaryGenerated'));
		});
	}

	async function handleUploadPrimary(event: FormEvent) {
		event.preventDefault();
		const ok = await confirm({
			title: t('confirmUploadPrimaryTitle'),
			description: t('confirmUploadPrimary'),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t('uploadPrimary'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await uploadIdpSigningCert({
				signingCertPem: uploadCert,
				signingPrivateKeyPem: uploadKey,
			});
			setShowUpload(false);
			setUploadCert('');
			setUploadKey('');
			await reload();
			setSuccess(t('successPrimaryUploaded'));
			showToast(t('toastPrimaryUploaded'));
		});
	}

	async function handleStartRotationGenerate() {
		const ok = await confirm({
			title: t('confirmStartRotationTitle'),
			description: t('confirmStartRotation'),
			tone: 'warning',
			showAuditNote: true,
			confirmLabel: t('startRotationGenerate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await startIdpCertRotation({ mode: 'generate' });
			await reload();
			setSuccess(t('successRotationStarted'));
			showToast(t('toastRotationStarted'));
		});
	}

	async function handleCompleteRotation() {
		const ok = await confirm({
			title: t('confirmCompleteRotationTitle'),
			description: t('confirmCompleteRotation'),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'COMPLETE', label: t('typeCompleteToConfirm') },
			confirmLabel: t('completeRotation'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await completeIdpCertRotation();
			await reload();
			setSuccess(t('successRotationCompleted'));
			showToast(t('toastRotationCompleted'));
		});
	}

	async function handleCancelRotation() {
		const ok = await confirm({
			title: t('confirmCancelRotationTitle'),
			description: t('confirmCancelRotation'),
			tone: 'warning',
			confirmLabel: t('cancelRotation'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await cancelIdpCertRotation();
			await reload();
			setSuccess(t('successRotationCancelled'));
			showToast(t('toastRotationCancelled'));
		});
	}

	async function handleRefreshMetadataPreview() {
		await runMutation(async () => {
			const preview = await getIdpMetadataPreview();
			setMetadataPreview(preview.xml);
		});
	}

	if (loading) {
		return <LoadingState message={t('loading')} />;
	}

	if (!settings) {
		return <ErrorBanner message={error ?? t('unavailable')} />;
	}

	return (
		<section>
			<AdminBreadcrumbs
				items={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('title') }]}
			/>
			<AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
			{error ? <ErrorBanner message={error} /> : null}
			{success ? <p className="evg-success-text">{success}</p> : null}

			<Panel title={t('overview')}>
				<ul className="evg-dl">
					<li>
						<span>{t('metadataUrl')}</span>
						<code>{settings.metadataUrl}</code>
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => copyText(t('metadataUrl'), settings.metadataUrl)}
						>
							{tCommon('copy')}
						</Button>
					</li>
					<li>
						<span>{t('ssoUrl')}</span>
						<code>{settings.ssoUrl}</code>
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => copyText(t('ssoUrl'), settings.ssoUrl)}
						>
							{tCommon('copy')}
						</Button>
					</li>
					<li>
						<span>{t('idpBaseUrl')}</span>
						<code>{settings.idpBaseUrl}</code>
					</li>
				</ul>
			</Panel>

			{settings.entityId !== settings.idpBaseUrl ? (
				<ErrorBanner message={t('entityIdMismatch')} />
			) : null}

			{isExpiringSoon(settings.signingCertNotAfter) ? (
				<p className="evg-callout evg-callout--warning">
					{t('certExpiresWarning', { date: settings.signingCertNotAfter })}
				</p>
			) : null}

			<Panel title={t('entityIdPanel')}>
				<form
					className="evg-stack"
					aria-busy={busy}
					onSubmit={(event) => void handleSaveEntityId(event)}
				>
					<fieldset className="evg-stack" disabled={busy}>
						<TextInput
							label={tCommon('entityId')}
							name="entityId"
							value={entityId}
							onChange={(event) => setEntityId(event.target.value)}
						/>
						<Button type="submit" variant="primary" disabled={busy}>
							{busy ? tCommon('saving') : t('saveEntityId')}
						</Button>
					</fieldset>
				</form>
			</Panel>

			<Panel title={t('defaultNameIdFormat')}>
				<p className="evg-muted">{t('defaultNameIdHint')}</p>
				<form
					className="evg-stack"
					aria-busy={busy}
					onSubmit={(event) => void handleSaveNameIdFormat(event)}
				>
					<fieldset className="evg-stack" disabled={busy}>
						<Select
							label={t('defaultNameIdFormat')}
							value={nameIdFormat}
							onChange={(event) => setNameIdFormat(event.target.value)}
						>
							{SAML_NAME_ID_FORMATS.map((format) => (
								<option key={format} value={format}>
									{format}
								</option>
							))}
						</Select>
						<Button type="submit" variant="primary" disabled={busy}>
							{busy ? tCommon('saving') : t('saveNameIdFormat')}
						</Button>
					</fieldset>
				</form>
			</Panel>

			<Panel title={t('signingCertificate')}>
				<p>
					<span className="evg-badge evg-badge--info">{t(certStatusKey(settings))}</span>
				</p>
				<ul className="evg-dl">
					<li>
						<span>{t('fingerprint')}</span>
						<code>{settings.signingCertFingerprintSha256 ?? tCommon('emDash')}</code>
					</li>
					<li>
						<span>{t('notAfter')}</span>
						<code>{settings.signingCertNotAfter ?? tCommon('emDash')}</code>
					</li>
				</ul>
				<div className="evg-cluster">
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active}
						onClick={() => void handleGeneratePrimary()}
					>
						{t('generateCertificate')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active}
						onClick={() => setShowUpload(true)}
					>
						{t('uploadCertificate')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active || !settings.hasSigningCertificate}
						onClick={() => void handleStartRotationGenerate()}
					>
						{t('startRotationGenerate')}
					</Button>
				</div>
			</Panel>

			{showUpload ? (
				<Panel title={t('uploadPrimary')}>
					<form
						className="evg-stack"
						aria-busy={busy}
						onSubmit={(event) => void handleUploadPrimary(event)}
					>
						<fieldset className="evg-stack" disabled={busy}>
							<TextArea
								label={t('signingCertPem')}
								rows={6}
								hint={t('signingCertHint')}
								value={uploadCert}
								onChange={(event) => setUploadCert(event.target.value)}
							/>
							<TextArea
								label={t('privateKeyPem')}
								rows={6}
								hint={t('privateKeyHint')}
								value={uploadKey}
								onChange={(event) => setUploadKey(event.target.value)}
							/>
							<div className="evg-cluster">
								<Button type="submit" variant="primary" disabled={busy}>
									{tCommon('upload')}
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={busy}
									onClick={() => setShowUpload(false)}
								>
									{tCommon('cancel')}
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			) : null}

			{settings.rotation.active ? (
				<Panel title={t('certificateRotation')}>
					{isStaleRotation(settings.rotation.startedAt) ? (
						<p className="evg-callout evg-callout--info">
							{t('rotationStale', { date: settings.rotation.startedAt })}
						</p>
					) : null}
					<p className="evg-muted">
						{t('pendingFingerprint', {
							fingerprint: settings.rotation.pendingCertFingerprintSha256 ?? tCommon('emDash'),
						})}
					</p>
					<ol className="evg-checklist">
						<li>{t('rotationStep1')}</li>
						<li>
							{t('rotationStep2')}{' '}
							<Link to={SP_CONNECTION_ROUTE_PREFIX}>{t('openSpConnections')}</Link>
						</li>
						<li>{t('rotationStep3')}</li>
						<li>{t('rotationStep4')}</li>
					</ol>
					<div className="evg-cluster">
						<Button
							type="button"
							variant="primary"
							disabled={busy}
							onClick={() => void handleCompleteRotation()}
						>
							{t('completeRotation')}
						</Button>
						<Button
							type="button"
							variant="danger"
							disabled={busy}
							onClick={() => void handleCancelRotation()}
						>
							{t('cancelRotation')}
						</Button>
					</div>
				</Panel>
			) : null}

			<Panel title={t('metadataPreview')}>
				<Button
					type="button"
					variant="secondary"
					disabled={busy}
					onClick={() => void handleRefreshMetadataPreview()}
				>
					{t('refreshPreview')}
				</Button>
				{metadataPreview ? <CodeBlock>{metadataPreview}</CodeBlock> : null}
			</Panel>

			<p className="evg-callout evg-callout--info">{t('lazyAutoGenNote')}</p>
		</section>
	);
}
