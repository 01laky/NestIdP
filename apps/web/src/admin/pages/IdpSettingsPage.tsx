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
	cancelIdpCertRotation,
	cancelIdpEncryptionCertRotation,
	completeIdpCertRotation,
	completeIdpEncryptionCertRotation,
	generateIdpEncryptionCert,
	generateIdpSigningCert,
	getIdpEncryptionCertPublicPem,
	getIdpMetadataPreview,
	getIdpSettings,
	runCertRotationCheck,
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
import { CertificateSection } from '../components/idp-cert/CertificateSection';
import { AdminBreadcrumbs } from '../components/layout/AdminBreadcrumbs';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { type CertActionContext, useCertActions } from '../hooks/useCertActions';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../i18n/api-error-messages';
import {
	Button,
	Callout,
	Checkbox,
	CodeBlock,
	Panel,
	Select,
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
					setError(mapAdminError(err, 'idpSettings.loadFailed'));
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
			setError(mapAdminError(err, 'idpSettings.requestFailed'));
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

	async function handleToggleAutoRotation(kind: 'signing' | 'encryption', enabled: boolean) {
		await runMutation(async () => {
			await updateIdpSettings(
				kind === 'signing'
					? { autoRotateSigningEnabled: enabled }
					: { autoRotateEncryptionEnabled: enabled },
			);
			await reload();
			showToast(t('autoRotation.toastUpdated'));
		});
	}

	async function handleRunRotationCheck() {
		await runMutation(async () => {
			await runCertRotationCheck();
			await reload();
			showToast(t('autoRotation.toastChecked'));
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

	const certActionContext: CertActionContext = {
		t,
		confirm,
		runMutation,
		reload,
		refreshMetadataPreview,
		setSuccess,
		showToast,
	};

	const signingActions = useCertActions<GenerateIdpSigningCertRequestDto>(
		{
			options: certOptions,
			buildSummary: buildCertOptionsConfirmSummary,
			generate: (options) => generateIdpSigningCert(options),
			startRotation: (options) => startIdpCertRotation({ mode: 'generate', ...options }),
			upload: () =>
				uploadIdpSigningCert({ signingCertPem: uploadCert, signingPrivateKeyPem: uploadKey }),
			onUploadSuccess: () => {
				setShowUpload(false);
				setUploadCert('');
				setUploadKey('');
			},
			complete: () => completeIdpCertRotation(),
			cancel: () => cancelIdpCertRotation(),
			keys: {
				confirmGenerateTitle: 'confirmGeneratePrimaryTitle',
				confirmGenerate: 'confirmGeneratePrimary',
				generateLabel: 'generateCertificate',
				successGenerated: 'successPrimaryGenerated',
				toastGenerated: 'toastCertGeneratedViewMetadata',
				confirmUploadTitle: 'confirmUploadPrimaryTitle',
				confirmUpload: 'confirmUploadPrimary',
				uploadLabel: 'uploadPrimary',
				successUploaded: 'successPrimaryUploaded',
				toastUploaded: 'toastPrimaryUploaded',
				confirmStartRotationTitle: 'confirmStartRotationTitle',
				confirmStartRotation: 'confirmStartRotation',
				startRotationLabel: 'startRotationGenerate',
				successRotationStarted: 'successRotationStarted',
				toastRotationStarted: 'toastRotationStarted',
				confirmCompleteTitle: 'confirmCompleteRotationTitle',
				confirmComplete: 'confirmCompleteRotation',
				completeLabel: 'completeRotation',
				successCompleted: 'successRotationCompleted',
				toastCompleted: 'toastRotationCompleted',
				confirmCancelTitle: 'confirmCancelRotationTitle',
				confirmCancel: 'confirmCancelRotation',
				cancelLabel: 'cancelRotation',
				successCancelled: 'successRotationCancelled',
				toastCancelled: 'toastRotationCancelled',
			},
		},
		certActionContext,
	);

	const encryptionActions = useCertActions<GenerateIdpEncryptionCertRequestDto>(
		{
			options: encCertOptions,
			buildSummary: buildEncryptionCertOptionsConfirmSummary,
			generate: (options) => generateIdpEncryptionCert(options),
			startRotation: (options) => startIdpEncryptionCertRotation({ mode: 'generate', ...options }),
			upload: () =>
				uploadIdpEncryptionCert({
					encryptionCertPem: uploadEncCert,
					encryptionPrivateKeyPem: uploadEncKey,
				}),
			onUploadSuccess: () => {
				setShowEncUpload(false);
				setUploadEncCert('');
				setUploadEncKey('');
			},
			complete: () => completeIdpEncryptionCertRotation(),
			cancel: () => cancelIdpEncryptionCertRotation(),
			keys: {
				confirmGenerateTitle: 'encryption.confirmGeneratePrimaryTitle',
				confirmGenerate: 'encryption.confirmGeneratePrimary',
				generateLabel: 'encryption.generateCertificate',
				successGenerated: 'encryption.successPrimaryGenerated',
				toastGenerated: 'encryption.toastPrimaryGenerated',
				confirmUploadTitle: 'encryption.confirmUploadPrimaryTitle',
				confirmUpload: 'encryption.confirmUploadPrimary',
				uploadLabel: 'encryption.uploadPrimary',
				successUploaded: 'encryption.successPrimaryUploaded',
				toastUploaded: 'encryption.toastPrimaryUploaded',
				confirmStartRotationTitle: 'encryption.confirmStartRotationTitle',
				confirmStartRotation: 'encryption.confirmStartRotation',
				startRotationLabel: 'encryption.startRotationGenerate',
				successRotationStarted: 'encryption.successRotationStarted',
				toastRotationStarted: 'encryption.toastRotationStarted',
				confirmCompleteTitle: 'encryption.confirmCompleteRotationTitle',
				confirmComplete: 'encryption.confirmCompleteRotation',
				completeLabel: 'encryption.completeRotation',
				successCompleted: 'encryption.successRotationCompleted',
				toastCompleted: 'encryption.toastRotationCompleted',
				confirmCancelTitle: 'encryption.confirmCancelRotationTitle',
				confirmCancel: 'encryption.confirmCancelRotation',
				cancelLabel: 'encryption.cancelRotation',
				successCancelled: 'encryption.successRotationCancelled',
				toastCancelled: 'encryption.toastRotationCancelled',
			},
		},
		certActionContext,
	);

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

	// The real DTO always carries `auto`; fall back defensively so partial test stubs never crash.
	const emptyAuto = {
		enabled: false,
		disabledAt: null,
		consecutiveFailures: 0,
		lastError: null,
		willAutoStartBy: null,
		willAutoCompleteAt: null,
	};
	const signingAuto = settings.rotation.auto ?? emptyAuto;
	const encryptionAuto = settings.encryptionRotation.auto ?? emptyAuto;

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

			<Panel title={t('autoRotation.title')}>
				<Callout variant="info">{t('autoRotation.callout')}</Callout>
				<fieldset className="evg-stack" disabled={busy}>
					<Checkbox
						label={t('autoRotation.enableSigning')}
						hint={t('autoRotation.enableHint')}
						checked={signingAuto.enabled}
						onChange={(v) => void handleToggleAutoRotation('signing', v)}
					/>
					{signingAuto.disabledAt ? (
						<Callout variant="warning">{t('autoRotation.backoffDisabled')}</Callout>
					) : null}
					{signingAuto.lastError ? (
						<p className="evg-muted">
							{t('autoRotation.lastError', { error: signingAuto.lastError })}
						</p>
					) : null}
					{signingAuto.willAutoStartBy ? (
						<p className="evg-muted">
							{t('autoRotation.willStartBy', { date: signingAuto.willAutoStartBy })}
						</p>
					) : null}
					{signingAuto.willAutoCompleteAt ? (
						<p className="evg-muted">
							{t('autoRotation.willCompleteAt', {
								date: signingAuto.willAutoCompleteAt,
							})}
						</p>
					) : null}

					{settings.hasEncryptionCertificate ? (
						<>
							<Checkbox
								label={t('autoRotation.enableEncryption')}
								hint={t('autoRotation.enableHint')}
								checked={encryptionAuto.enabled}
								onChange={(v) => void handleToggleAutoRotation('encryption', v)}
							/>
							{encryptionAuto.disabledAt ? (
								<Callout variant="warning">{t('autoRotation.backoffDisabled')}</Callout>
							) : null}
						</>
					) : null}

					<p className="evg-muted">
						{t('autoRotation.lastCheck', {
							date: settings.lastAutoRotationCheckAt ?? tCommon('emDash'),
						})}
						{' · '}
						{t('autoRotation.lastAction', {
							date: settings.lastAutoRotationActionAt ?? tCommon('emDash'),
						})}
					</p>
					<Button
						type="button"
						variant="secondary"
						disabled={busy}
						onClick={() => void handleRunRotationCheck()}
					>
						{t('autoRotation.runCheck')}
					</Button>
				</fieldset>
			</Panel>

			<CertificateSection
				t={t}
				tCommon={tCommon}
				busy={busy}
				panelTitle={t('signingCertificate')}
				statusBadge={t(certStatusKey(settings))}
				fingerprint={settings.signingCertFingerprintSha256}
				notAfter={settings.signingCertNotAfter}
				cryptoRows={
					<>
						{settings.signingKeyFamily ? (
							<div className="evg-dl__row">
								<dt>{t('crypto.keyFamily')}</dt>
								<dd>
									<code>
										{settings.signingKeyFamily === 'rsa'
											? `RSA ${settings.signingRsaModulusBits ?? 2048}`
											: `EC ${settings.signingEcCurve ?? 'P-256'}`}
									</code>
								</dd>
							</div>
						) : null}
						{settings.signingSignatureAlgorithmId ? (
							<div className="evg-dl__row">
								<dt>{t('crypto.signatureAlgorithm')}</dt>
								<dd>
									<code>
										{t(`crypto.algorithms.${settings.signingSignatureAlgorithmId}`, {
											defaultValue: settings.signingSignatureAlgorithmId,
										})}
									</code>
								</dd>
							</div>
						) : null}
					</>
				}
				optionsFields={
					<IdpSigningCertOptionsFields
						value={certOptions}
						onChange={setCertOptions}
						disabled={busy || settings.rotation.active}
					/>
				}
				actions={
					<div className="evg-cluster">
						<Button
							type="button"
							variant="secondary"
							disabled={busy || settings.rotation.active}
							onClick={() => void signingActions.generatePrimary()}
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
							onClick={() => void signingActions.startRotationGenerate()}
						>
							{t('startRotationGenerate')}
						</Button>
					</div>
				}
				showUpload={showUpload}
				uploadTitle={t('uploadPrimary')}
				uploadCertLabel={t('signingCertPem')}
				uploadCertHint={t('signingCertHint')}
				uploadCertValue={uploadCert}
				onUploadCertChange={setUploadCert}
				uploadKeyLabel={t('privateKeyPem')}
				uploadKeyHint={t('privateKeyHint')}
				uploadKeyValue={uploadKey}
				onUploadKeyChange={setUploadKey}
				onUploadSubmit={() => void signingActions.uploadPrimary()}
				onUploadCancel={() => setShowUpload(false)}
				rotationActive={settings.rotation.active}
				rotationTitle={t('certificateRotation')}
				rotationStaleText={
					isStaleRotation(settings.rotation.startedAt)
						? t('rotationStale', { date: settings.rotation.startedAt })
						: null
				}
				pendingCertTitle={t('pendingCertTitle')}
				pendingFingerprintText={t('pendingFingerprint', {
					fingerprint: settings.rotation.pendingCertFingerprintSha256 ?? tCommon('emDash'),
				})}
				pendingCrypto={
					settings.rotation.pendingSigningKeyFamily ? (
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
					) : null
				}
				mismatchWarning={
					settings.rotation.pendingSigningSignatureAlgorithmId &&
					settings.signingSignatureAlgorithmId &&
					settings.rotation.pendingSigningSignatureAlgorithmId !==
						settings.signingSignatureAlgorithmId ? (
						<Callout variant="warning">{t('rotationAlgorithmMismatchWarning')}</Callout>
					) : null
				}
				rotationSteps={[
					t('rotationStep1'),
					t('rotationStep2'),
					t('rotationStep3'),
					t('rotationStep4'),
				]}
				openSpConnectionsLabel={t('openSpConnections')}
				completeLabel={t('completeRotation')}
				cancelLabel={t('cancelRotation')}
				onComplete={() => void signingActions.completeRotation()}
				onCancel={() => void signingActions.cancelRotation()}
			/>

			<CertificateSection
				t={t}
				tCommon={tCommon}
				busy={busy}
				panelTitle={t('encryption.encryptionCertificate')}
				statusBadge={t(encryptionCertStatusKey(settings))}
				panelHint={t('encryption.panelHint')}
				fingerprint={settings.encryptionCertFingerprintSha256}
				notAfter={settings.encryptionCertNotAfter}
				cryptoRows={
					<>
						{settings.encryptionKeyFamily ? (
							<div className="evg-dl__row">
								<dt>{t('encryption.crypto.keyFamily')}</dt>
								<dd>
									<code>
										{settings.encryptionKeyFamily === 'rsa'
											? `RSA ${settings.encryptionRsaModulusBits ?? 2048}`
											: `EC ${settings.encryptionEcCurve ?? 'P-256'}`}
									</code>
								</dd>
							</div>
						) : null}
						{settings.encryptionKeyTransportAlgorithmId ? (
							<div className="evg-dl__row">
								<dt>{t('encryption.crypto.keyTransportAlgorithm')}</dt>
								<dd>
									<code>
										{t(
											`encryption.crypto.algorithms.${settings.encryptionKeyTransportAlgorithmId}`,
											{ defaultValue: settings.encryptionKeyTransportAlgorithmId },
										)}
									</code>
								</dd>
							</div>
						) : null}
					</>
				}
				afterDetailList={
					settings.encryptionKeyFamily === 'ec' ? (
						<Callout variant="info">{t('encryptionEcKeyAgreementInfo')}</Callout>
					) : null
				}
				optionsFields={
					<IdpEncryptionCertOptionsFields
						value={encCertOptions}
						onChange={setEncCertOptions}
						disabled={busy || settings.encryptionRotation.active}
					/>
				}
				actions={
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
							onClick={() => void encryptionActions.generatePrimary()}
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
							onClick={() => void encryptionActions.startRotationGenerate()}
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
				}
				showUpload={showEncUpload}
				uploadTitle={t('encryption.uploadPrimary')}
				uploadCertLabel={t('encryption.encryptionCertPem')}
				uploadCertHint={t('encryption.encryptionCertHint')}
				uploadCertValue={uploadEncCert}
				onUploadCertChange={setUploadEncCert}
				uploadKeyLabel={t('encryption.privateKeyPem')}
				uploadKeyHint={t('encryption.privateKeyHint')}
				uploadKeyValue={uploadEncKey}
				onUploadKeyChange={setUploadEncKey}
				onUploadSubmit={() => void encryptionActions.uploadPrimary()}
				onUploadCancel={() => setShowEncUpload(false)}
				rotationActive={settings.encryptionRotation.active}
				rotationTitle={t('encryption.certificateRotation')}
				rotationStaleText={
					isStaleEncryptionRotation(settings.encryptionRotation.startedAt)
						? t('encryption.rotationStale', { date: settings.encryptionRotation.startedAt })
						: null
				}
				pendingCertTitle={t('encryption.pendingCertTitle')}
				pendingFingerprintText={t('encryption.pendingFingerprint', {
					fingerprint:
						settings.encryptionRotation.pendingCertFingerprintSha256 ?? tCommon('emDash'),
				})}
				pendingCrypto={
					settings.encryptionRotation.pendingEncryptionKeyFamily ? (
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
					) : null
				}
				mismatchWarning={
					settings.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId &&
					settings.encryptionKeyTransportAlgorithmId &&
					settings.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId !==
						settings.encryptionKeyTransportAlgorithmId ? (
						<Callout variant="warning">{t('encryption.rotationTransportMismatchWarning')}</Callout>
					) : null
				}
				rotationSteps={[
					t('encryption.rotationStep1'),
					t('encryption.rotationStep2'),
					t('encryption.rotationStep3'),
					t('encryption.rotationStep4'),
				]}
				openSpConnectionsLabel={t('openSpConnections')}
				completeLabel={t('encryption.completeRotation')}
				cancelLabel={t('encryption.cancelRotation')}
				onComplete={() => void encryptionActions.completeRotation()}
				onCancel={() => void encryptionActions.cancelRotation()}
			/>

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
