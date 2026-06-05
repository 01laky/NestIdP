import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
	GenerateIdpEncryptionCertRequestDto,
	GenerateIdpSigningCertRequestDto,
	IdpSettingsPublicDto,
} from '@nestidp/shared';
import {
	getDefaultGenerateIdpEncryptionCertRequest,
	getDefaultGenerateIdpSigningCertRequest,
	IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
	IDP_ROTATION_STALE_WARNING_DAYS,
	IDP_CERT_EXPIRY_WARNING_DAYS,
	SAML_NAME_ID_FORMATS,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import {
	AdminApiError,
	cancelIdpCertRotation,
	cancelIdpEncryptionCertRotation,
	completeIdpCertRotation,
	completeIdpEncryptionCertRotation,
	generateIdpEncryptionCert,
	generateIdpSigningCert,
	getIdpEncryptionCertPublicPem,
	getIdpMetadataPreview,
	getIdpSettings,
	startIdpCertRotation,
	startIdpEncryptionCertRotation,
	updateIdpSettings,
	uploadIdpEncryptionCert,
	uploadIdpSigningCert,
} from '../adminApi';
import {
	buildEncryptionCertOptionsConfirmSummary,
	IdpEncryptionCertOptionsFields,
} from '../components/idp-cert/IdpEncryptionCertOptionsFields';
import {
	buildCertOptionsConfirmSummary,
	IdpSigningCertOptionsFields,
} from '../components/idp-cert/IdpSigningCertOptionsFields';
import { AdminBreadcrumbs } from '../components/layout/AdminBreadcrumbs';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import {
	Button,
	Callout,
	Checkbox,
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

function encryptionCertStatusKey(settings: IdpSettingsPublicDto): string {
	if (settings.encryptionRotation.active) {
		return 'encryption.certStatusRotation';
	}
	if (!settings.hasEncryptionCertificate) {
		return 'encryption.certStatusMissing';
	}
	if (isExpiringSoon(settings.encryptionCertNotAfter)) {
		return 'encryption.certStatusExpiresSoon';
	}
	return 'encryption.certStatusOk';
}

function isStaleEncryptionRotation(startedAt: string | null): boolean {
	return isStaleRotation(startedAt);
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
	const [wantAuthnRequestsSigned, setWantAuthnRequestsSigned] = useState(false);
	const [metadataPreview, setMetadataPreview] = useState<string | null>(null);
	const [showUpload, setShowUpload] = useState(false);
	const [uploadCert, setUploadCert] = useState('');
	const [uploadKey, setUploadKey] = useState('');
	const [busy, setBusy] = useState(false);
	const [certOptions, setCertOptions] = useState<GenerateIdpSigningCertRequestDto>(() =>
		getDefaultGenerateIdpSigningCertRequest(),
	);
	const [encCertOptions, setEncCertOptions] = useState<GenerateIdpEncryptionCertRequestDto>(() =>
		getDefaultGenerateIdpEncryptionCertRequest(),
	);
	const [showEncUpload, setShowEncUpload] = useState(false);
	const [uploadEncCert, setUploadEncCert] = useState('');
	const [uploadEncKey, setUploadEncKey] = useState('');

	async function reload(): Promise<IdpSettingsPublicDto> {
		const data = await getIdpSettings();
		setSettings(data);
		setEntityId(data.entityId);
		setNameIdFormat(data.nameIdFormat);
		setWantAuthnRequestsSigned(data.wantAuthnRequestsSigned);
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

	async function handleSaveWantAuthnRequestsSigned(event: FormEvent) {
		event.preventDefault();
		await runMutation(async () => {
			await updateIdpSettings({ wantAuthnRequestsSigned });
			await reload();
			setSuccess(t('successWantAuthnRequestsSignedUpdated'));
			showToast(t('toastWantAuthnRequestsSignedUpdated'));
		});
	}

	async function copyText(_label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			showToast(tCommon('copyFailed'));
		}
	}

	async function refreshMetadataPreview() {
		const preview = await getIdpMetadataPreview();
		setMetadataPreview(preview.xml);
	}

	async function handleGeneratePrimary() {
		const ok = await confirm({
			title: t('confirmGeneratePrimaryTitle'),
			description: `${t('confirmGeneratePrimary')}\n\n${buildCertOptionsConfirmSummary(certOptions, t)}`,
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t('generateCertificate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await generateIdpSigningCert(certOptions);
			await reload();
			await refreshMetadataPreview();
			setSuccess(t('successPrimaryGenerated'));
			showToast(t('toastCertGeneratedViewMetadata'));
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
			description: `${t('confirmStartRotation')}\n\n${buildCertOptionsConfirmSummary(certOptions, t)}`,
			tone: 'warning',
			showAuditNote: true,
			confirmLabel: t('startRotationGenerate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await startIdpCertRotation({ mode: 'generate', ...certOptions });
			await reload();
			await refreshMetadataPreview();
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
			await refreshMetadataPreview();
		});
	}

	function copySigningOptionsToEncryption() {
		const family = certOptions.keyFamily ?? 'rsa';
		setEncCertOptions({
			keyFamily: family,
			rsaModulusBits: certOptions.rsaModulusBits,
			ecCurve: certOptions.ecCurve,
			notAfter: certOptions.notAfter,
			keyTransportAlgorithmId:
				family === 'rsa' ? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID : undefined,
		});
		showToast(t('encryption.toastCopiedSigningOptions'));
	}

	async function handleGenerateEncryptionPrimary() {
		const ok = await confirm({
			title: t('encryption.confirmGeneratePrimaryTitle'),
			description: `${t('encryption.confirmGeneratePrimary')}\n\n${buildEncryptionCertOptionsConfirmSummary(encCertOptions, t)}`,
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t('encryption.generateCertificate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await generateIdpEncryptionCert(encCertOptions);
			await reload();
			await refreshMetadataPreview();
			setSuccess(t('encryption.successPrimaryGenerated'));
			showToast(t('encryption.toastPrimaryGenerated'));
		});
	}

	async function handleUploadEncryptionPrimary(event: FormEvent) {
		event.preventDefault();
		const ok = await confirm({
			title: t('encryption.confirmUploadPrimaryTitle'),
			description: t('encryption.confirmUploadPrimary'),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t('encryption.uploadPrimary'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await uploadIdpEncryptionCert({
				encryptionCertPem: uploadEncCert,
				encryptionPrivateKeyPem: uploadEncKey,
			});
			setShowEncUpload(false);
			setUploadEncCert('');
			setUploadEncKey('');
			await reload();
			setSuccess(t('encryption.successPrimaryUploaded'));
			showToast(t('encryption.toastPrimaryUploaded'));
		});
	}

	async function handleStartEncryptionRotationGenerate() {
		const ok = await confirm({
			title: t('encryption.confirmStartRotationTitle'),
			description: `${t('encryption.confirmStartRotation')}\n\n${buildEncryptionCertOptionsConfirmSummary(encCertOptions, t)}`,
			tone: 'warning',
			showAuditNote: true,
			confirmLabel: t('encryption.startRotationGenerate'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await startIdpEncryptionCertRotation({ mode: 'generate', ...encCertOptions });
			await reload();
			await refreshMetadataPreview();
			setSuccess(t('encryption.successRotationStarted'));
			showToast(t('encryption.toastRotationStarted'));
		});
	}

	async function handleCompleteEncryptionRotation() {
		const ok = await confirm({
			title: t('encryption.confirmCompleteRotationTitle'),
			description: t('encryption.confirmCompleteRotation'),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'COMPLETE', label: t('typeCompleteToConfirm') },
			confirmLabel: t('encryption.completeRotation'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await completeIdpEncryptionCertRotation();
			await reload();
			setSuccess(t('encryption.successRotationCompleted'));
			showToast(t('encryption.toastRotationCompleted'));
		});
	}

	async function handleCancelEncryptionRotation() {
		const ok = await confirm({
			title: t('encryption.confirmCancelRotationTitle'),
			description: t('encryption.confirmCancelRotation'),
			tone: 'warning',
			confirmLabel: t('encryption.cancelRotation'),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await cancelIdpEncryptionCertRotation();
			await reload();
			setSuccess(t('encryption.successRotationCancelled'));
			showToast(t('encryption.toastRotationCancelled'));
		});
	}

	async function handleCopyEncryptionPublicPem() {
		await runMutation(async () => {
			const { certPem } = await getIdpEncryptionCertPublicPem();
			await copyText(t('encryption.publicPem'), certPem);
			showToast(t('encryption.toastPublicPemCopied'));
		});
	}

	async function handleDownloadEncryptionPublicPem() {
		await runMutation(async () => {
			const { certPem } = await getIdpEncryptionCertPublicPem();
			const blob = new Blob([certPem], { type: 'application/x-pem-file' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'idp-encryption-cert.pem';
			anchor.click();
			URL.revokeObjectURL(url);
			showToast(t('encryption.toastPublicPemDownloaded'));
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
			{isExpiringSoon(settings.encryptionCertNotAfter) ? (
				<p className="evg-callout evg-callout--warning">
					{t('encryption.certExpiresWarning', { date: settings.encryptionCertNotAfter })}
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

			<Panel title={t('samlBehavior')}>
				<Callout variant="info">
					{t('wantAuthnRequestsSignedCallout')}{' '}
					<Link to={SP_CONNECTION_ROUTE_PREFIX}>{t('openSpConnections')}</Link>
				</Callout>
				<form
					className="evg-stack"
					aria-busy={busy}
					onSubmit={(event) => void handleSaveWantAuthnRequestsSigned(event)}
				>
					<fieldset className="evg-stack" disabled={busy}>
						<Checkbox
							label={t('wantAuthnRequestsSigned')}
							hint={t('wantAuthnRequestsSignedHint')}
							checked={wantAuthnRequestsSigned}
							onChange={setWantAuthnRequestsSigned}
						/>
						<Button type="submit" variant="primary" disabled={busy}>
							{busy ? tCommon('saving') : t('saveWantAuthnRequestsSigned')}
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
					{settings.signingKeyFamily ? (
						<li>
							<span>{t('crypto.keyFamily')}</span>
							<code>
								{settings.signingKeyFamily === 'rsa'
									? `RSA ${settings.signingRsaModulusBits ?? 2048}`
									: `EC ${settings.signingEcCurve ?? 'P-256'}`}
							</code>
						</li>
					) : null}
					{settings.signingSignatureAlgorithmId ? (
						<li>
							<span>{t('crypto.signatureAlgorithm')}</span>
							<code>
								{t(`crypto.algorithms.${settings.signingSignatureAlgorithmId}`, {
									defaultValue: settings.signingSignatureAlgorithmId,
								})}
							</code>
						</li>
					) : null}
				</ul>
				<IdpSigningCertOptionsFields
					value={certOptions}
					onChange={setCertOptions}
					disabled={busy || settings.rotation.active}
				/>
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
					<h3 className="evg-panel__title">{t('pendingCertTitle')}</h3>
					<p className="evg-muted">
						{t('pendingFingerprint', {
							fingerprint: settings.rotation.pendingCertFingerprintSha256 ?? tCommon('emDash'),
						})}
					</p>
					{settings.rotation.pendingSigningKeyFamily ? (
						<p className="evg-muted">
							{t('crypto.keyFamily')}: {settings.rotation.pendingSigningKeyFamily}
							{settings.rotation.pendingSigningKeyFamily === 'rsa'
								? ` ${settings.rotation.pendingSigningRsaModulusBits ?? 2048}`
								: ` ${settings.rotation.pendingSigningEcCurve ?? 'P-256'}`}
							{' · '}
							{t('crypto.signatureAlgorithm')}:{' '}
							{settings.rotation.pendingSigningSignatureAlgorithmId ?? tCommon('emDash')}
							{' · '}
							{t('notAfter')}: {settings.rotation.pendingSigningCertNotAfter ?? tCommon('emDash')}
						</p>
					) : null}
					{settings.rotation.pendingSigningSignatureAlgorithmId &&
					settings.signingSignatureAlgorithmId &&
					settings.rotation.pendingSigningSignatureAlgorithmId !==
						settings.signingSignatureAlgorithmId ? (
						<Callout variant="warning">{t('rotationAlgorithmMismatchWarning')}</Callout>
					) : null}
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

			<Panel title={t('encryption.encryptionCertificate')}>
				<p>
					<span className="evg-badge evg-badge--info">{t(encryptionCertStatusKey(settings))}</span>
				</p>
				{settings.encryptionKeyFamily === 'ec' ? (
					<Callout variant="info">{t('encryptionEcKeyAgreementInfo')}</Callout>
				) : null}
				<p className="evg-muted">{t('encryption.panelHint')}</p>
				<ul className="evg-dl">
					<li>
						<span>{t('fingerprint')}</span>
						<code>{settings.encryptionCertFingerprintSha256 ?? tCommon('emDash')}</code>
					</li>
					<li>
						<span>{t('notAfter')}</span>
						<code>{settings.encryptionCertNotAfter ?? tCommon('emDash')}</code>
					</li>
					{settings.encryptionKeyFamily ? (
						<li>
							<span>{t('encryption.crypto.keyFamily')}</span>
							<code>
								{settings.encryptionKeyFamily === 'rsa'
									? `RSA ${settings.encryptionRsaModulusBits ?? 2048}`
									: `EC ${settings.encryptionEcCurve ?? 'P-256'}`}
							</code>
						</li>
					) : null}
					{settings.encryptionKeyTransportAlgorithmId ? (
						<li>
							<span>{t('encryption.crypto.keyTransportAlgorithm')}</span>
							<code>
								{t(`encryption.crypto.algorithms.${settings.encryptionKeyTransportAlgorithmId}`, {
									defaultValue: settings.encryptionKeyTransportAlgorithmId,
								})}
							</code>
						</li>
					) : null}
				</ul>
				<IdpEncryptionCertOptionsFields
					value={encCertOptions}
					onChange={setEncCertOptions}
					disabled={busy || settings.encryptionRotation.active}
				/>
				<div className="evg-cluster evg-cluster--wrap">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={busy || settings.encryptionRotation.active}
						onClick={copySigningOptionsToEncryption}
					>
						{t('encryption.copySigningOptions')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.encryptionRotation.active}
						onClick={() => void handleGenerateEncryptionPrimary()}
					>
						{t('encryption.generateCertificate')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.encryptionRotation.active}
						onClick={() => setShowEncUpload(true)}
					>
						{t('encryption.uploadCertificate')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={
							busy || settings.encryptionRotation.active || !settings.hasEncryptionCertificate
						}
						onClick={() => void handleStartEncryptionRotationGenerate()}
					>
						{t('encryption.startRotationGenerate')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || !settings.hasEncryptionCertificate}
						onClick={() => void handleCopyEncryptionPublicPem()}
					>
						{t('encryption.copyPublicPem')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || !settings.hasEncryptionCertificate}
						onClick={() => void handleDownloadEncryptionPublicPem()}
					>
						{t('encryption.downloadPublicPem')}
					</Button>
				</div>
			</Panel>

			{showEncUpload ? (
				<Panel title={t('encryption.uploadPrimary')}>
					<form
						className="evg-stack"
						aria-busy={busy}
						onSubmit={(event) => void handleUploadEncryptionPrimary(event)}
					>
						<fieldset className="evg-stack" disabled={busy}>
							<TextArea
								label={t('encryption.encryptionCertPem')}
								rows={6}
								hint={t('encryption.encryptionCertHint')}
								value={uploadEncCert}
								onChange={(event) => setUploadEncCert(event.target.value)}
							/>
							<TextArea
								label={t('encryption.privateKeyPem')}
								rows={6}
								hint={t('encryption.privateKeyHint')}
								value={uploadEncKey}
								onChange={(event) => setUploadEncKey(event.target.value)}
							/>
							<div className="evg-cluster">
								<Button type="submit" variant="primary" disabled={busy}>
									{tCommon('upload')}
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={busy}
									onClick={() => setShowEncUpload(false)}
								>
									{tCommon('cancel')}
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			) : null}

			{settings.encryptionRotation.active ? (
				<Panel title={t('encryption.certificateRotation')}>
					{isStaleEncryptionRotation(settings.encryptionRotation.startedAt) ? (
						<p className="evg-callout evg-callout--info">
							{t('encryption.rotationStale', { date: settings.encryptionRotation.startedAt })}
						</p>
					) : null}
					<h3 className="evg-panel__title">{t('encryption.pendingCertTitle')}</h3>
					<p className="evg-muted">
						{t('encryption.pendingFingerprint', {
							fingerprint:
								settings.encryptionRotation.pendingCertFingerprintSha256 ?? tCommon('emDash'),
						})}
					</p>
					{settings.encryptionRotation.pendingEncryptionKeyFamily ? (
						<p className="evg-muted">
							{t('encryption.crypto.keyFamily')}:{' '}
							{settings.encryptionRotation.pendingEncryptionKeyFamily}
							{settings.encryptionRotation.pendingEncryptionKeyFamily === 'rsa'
								? ` ${settings.encryptionRotation.pendingEncryptionRsaModulusBits ?? 2048}`
								: ` ${settings.encryptionRotation.pendingEncryptionEcCurve ?? 'P-256'}`}
							{' · '}
							{t('encryption.crypto.keyTransportAlgorithm')}:{' '}
							{settings.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId ??
								tCommon('emDash')}
							{' · '}
							{t('notAfter')}:{' '}
							{settings.encryptionRotation.pendingEncryptionCertNotAfter ?? tCommon('emDash')}
						</p>
					) : null}
					{settings.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId &&
					settings.encryptionKeyTransportAlgorithmId &&
					settings.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId !==
						settings.encryptionKeyTransportAlgorithmId ? (
						<Callout variant="warning">{t('encryption.rotationTransportMismatchWarning')}</Callout>
					) : null}
					<ol className="evg-checklist">
						<li>{t('encryption.rotationStep1')}</li>
						<li>
							{t('encryption.rotationStep2')}{' '}
							<Link to={SP_CONNECTION_ROUTE_PREFIX}>{t('openSpConnections')}</Link>
						</li>
						<li>{t('encryption.rotationStep3')}</li>
						<li>{t('encryption.rotationStep4')}</li>
					</ol>
					<div className="evg-cluster">
						<Button
							type="button"
							variant="primary"
							disabled={busy}
							onClick={() => void handleCompleteEncryptionRotation()}
						>
							{t('encryption.completeRotation')}
						</Button>
						<Button
							type="button"
							variant="danger"
							disabled={busy}
							onClick={() => void handleCancelEncryptionRotation()}
						>
							{t('encryption.cancelRotation')}
						</Button>
					</div>
				</Panel>
			) : null}

			<Panel title={t('metadataPreview')} id="idp-metadata-preview">
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
