import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SpAttributeMappingConfig } from '@nestidp/shared';
import { SAML_NAME_ID_FORMATS, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	createSpConnection,
	deleteSpConnection,
	getSpConnection,
	parseSpSloFromMetadata,
	probeSpConnectionSigning,
	testSpConnectionAcs,
	testSpConnectionBackchannel,
	updateSpConnection,
} from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { AttributeMappingEditor } from '../components/mapping/AttributeMappingEditor';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import {
	Button,
	Callout,
	Checkbox,
	Panel,
	Select,
	TextArea,
	TextInput,
	useConfirmAction,
	useToast,
} from '../../ui';

export function SpConnectionFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const confirmAction = useConfirmAction();
	useAdminDocumentTitle(isNew ? t('formNew') : t('formEdit'));
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [spEntityId, setSpEntityId] = useState('');
	const [acsUrl, setAcsUrl] = useState('');
	const [sloUrl, setSloUrl] = useState('');
	const [sloSoapUrl, setSloSoapUrl] = useState('');
	const [nameIdFormat, setNameIdFormat] = useState('');
	const [active, setActive] = useState(true);
	const [wantAssertionsEncrypted, setWantAssertionsEncrypted] = useState(false);
	const [wantAuthnRequestsSigned, setWantAuthnRequestsSigned] = useState(false);
	const [wantLogoutRequestsSigned, setWantLogoutRequestsSigned] = useState(false);
	const [sloMetadataXml, setSloMetadataXml] = useState('');
	const [sloMetadataMessage, setSloMetadataMessage] = useState<string | null>(null);
	const [attributeMapping, setAttributeMapping] = useState<SpAttributeMappingConfig | null>(null);
	const [spCertificate, setSpCertificate] = useState('');
	const [hasStoredSpCertificate, setHasStoredSpCertificate] = useState(false);
	const [spCertificateTouched, setSpCertificateTouched] = useState(false);
	const [probeSpPrivateKeyPem, setProbeSpPrivateKeyPem] = useState('');
	const [probeSigningBusy, setProbeSigningBusy] = useState(false);
	const [probeSigningMessage, setProbeSigningMessage] = useState<string | null>(null);
	const [probeSigningError, setProbeSigningError] = useState<string | null>(null);
	const [acsTestMessage, setAcsTestMessage] = useState<string | null>(null);
	const [backchannelTestBusy, setBackchannelTestBusy] = useState(false);
	const [backchannelTestMessage, setBackchannelTestMessage] = useState<string | null>(null);
	const [backchannelTestOk, setBackchannelTestOk] = useState(false);
	const { showToast } = useToast();
	const [saving, setSaving] = useState(false);
	const hasSpCertificate = spCertificate.trim().length > 0 || hasStoredSpCertificate;

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const item = await getSpConnection(id);
				if (!cancelled) {
					setName(item.name);
					setSpEntityId(item.spEntityId);
					setAcsUrl(item.acsUrl);
					setSloUrl(item.sloUrl ?? '');
					setSloSoapUrl(item.sloSoapUrl ?? '');
					setNameIdFormat(item.nameIdFormat);
					setActive(item.active);
					setWantAssertionsEncrypted(item.wantAssertionsEncrypted);
					setWantAuthnRequestsSigned(item.wantAuthnRequestsSigned);
					setWantLogoutRequestsSigned(item.wantLogoutRequestsSigned);
					setAttributeMapping(item.attributeMapping);
					setHasStoredSpCertificate(item.hasSpCertificate);
					setSpCertificateTouched(false);
					setSpCertificate('');
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'spConnections.loadFailed',
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

	useEffect(() => {
		if (hasSpCertificate || !wantAuthnRequestsSigned) {
			return;
		}
		setWantAuthnRequestsSigned(false);
	}, [hasSpCertificate, wantAuthnRequestsSigned]);

	useEffect(() => {
		if (hasSpCertificate || !wantLogoutRequestsSigned) {
			return;
		}
		setWantLogoutRequestsSigned(false);
	}, [hasSpCertificate, wantLogoutRequestsSigned]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		const trimmedSpCertificate = spCertificate.trim();
		const spCertificateValue =
			isNew || spCertificateTouched
				? trimmedSpCertificate
					? trimmedSpCertificate
					: null
				: undefined;
		const body = {
			name,
			spEntityId,
			acsUrl,
			sloUrl: sloUrl.trim() ? sloUrl.trim() : null,
			sloSoapUrl: sloSoapUrl.trim() ? sloSoapUrl.trim() : null,
			nameIdFormat: nameIdFormat || undefined,
			active,
			wantAssertionsEncrypted,
			wantAuthnRequestsSigned,
			wantLogoutRequestsSigned,
			attributeMapping,
			...(spCertificateValue !== undefined ? { spCertificate: spCertificateValue } : {}),
		};
		try {
			if (isNew) {
				const created = await createSpConnection(body);
				showToast(t('toastSaved'));
				navigate(`${SP_CONNECTION_ROUTE_PREFIX}/${created.item.id}`);
			} else if (id) {
				await updateSpConnection(id, body);
				showToast(t('toastSaved'));
			}
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'spConnections.saveFailed',
						)
					: t('saveFailed'),
			);
		} finally {
			setSaving(false);
		}
	}

	async function handleAutofillSlo() {
		setSloMetadataMessage(null);
		try {
			const result = await parseSpSloFromMetadata(sloMetadataXml);
			const found = result.redirect ?? result.post;
			if (found) {
				setSloUrl(found);
			}
			if (result.soap) {
				setSloSoapUrl(result.soap);
			}
			if (found || result.soap) {
				setSloMetadataMessage(result.soap ? t('autofillSloSoapFound') : t('autofillSloFound'));
			} else {
				setSloMetadataMessage(t('autofillSloNotFound'));
			}
		} catch {
			setSloMetadataMessage(t('autofillSloNotFound'));
		}
	}

	async function handleDeactivateAndDelete() {
		if (!id) {
			return;
		}
		await confirmAction({
			title: t('confirmDeactivateDeleteTitle'),
			description: t('confirmDeactivateDelete'),
			tone: 'danger',
			showAuditNote: true,
			confirmLabel: tCommon('delete'),
			onConfirm: async () => {
				try {
					if (active) {
						await updateSpConnection(id, { active: false });
					}
					await deleteSpConnection(id);
					navigate(SP_CONNECTION_ROUTE_PREFIX);
				} catch (err) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'spConnections.deleteFailed',
								)
							: t('deleteFailed'),
					);
				}
			},
		});
	}

	async function handleTestAcs() {
		if (!id) {
			return;
		}
		try {
			const result = await testSpConnectionAcs(id);
			setAcsTestMessage(result.message);
		} catch (err) {
			setAcsTestMessage(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'spConnections.acsTestFailed',
						)
					: t('acsTestFailed'),
			);
		}
	}

	async function handleTestBackchannel() {
		if (!id) {
			return;
		}
		setBackchannelTestBusy(true);
		setBackchannelTestMessage(null);
		try {
			const result = await testSpConnectionBackchannel(id);
			setBackchannelTestOk(result.ok);
			setBackchannelTestMessage(
				result.ok
					? t('testBackchannelOk')
					: t('testBackchannelFailed', { reason: result.reason ?? tCommon('emDash') }),
			);
		} catch (err) {
			setBackchannelTestOk(false);
			setBackchannelTestMessage(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'spConnections.testBackchannelFailedGeneric',
						)
					: t('testBackchannelFailedGeneric'),
			);
		} finally {
			setBackchannelTestBusy(false);
		}
	}

	async function handleProbeSigning() {
		if (!id) {
			return;
		}
		setProbeSigningBusy(true);
		setProbeSigningMessage(null);
		setProbeSigningError(null);
		try {
			const result = await probeSpConnectionSigning(id, {
				spPrivateKeyPem: probeSpPrivateKeyPem,
			});
			if (result.ok) {
				setProbeSigningMessage(
					t('probeSigningSuccess', {
						fingerprint: result.fingerprintSha256 ?? tCommon('emDash'),
					}),
				);
				return;
			}
			setProbeSigningError(result.message ?? t('probeSigningFailed'));
		} catch (err) {
			setProbeSigningError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'spConnections.probeSigningFailed',
						)
					: t('probeSigningFailed'),
			);
		} finally {
			setProbeSigningBusy(false);
		}
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
					{ label: t('listTitle'), to: SP_CONNECTION_ROUTE_PREFIX },
					{ label: isNew ? tCommon('new') : name || id! },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<Panel title={t('spConnection')}>
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
							requiredMark
						/>
						<TextInput
							label={t('spEntityId')}
							name="spEntityId"
							value={spEntityId}
							onChange={(e) => setSpEntityId(e.target.value)}
							required
							requiredMark
						/>
						<TextInput
							label={t('acsUrl')}
							name="acsUrl"
							value={acsUrl}
							onChange={(e) => setAcsUrl(e.target.value)}
							required
							requiredMark
						/>
						<TextInput
							label={t('sloUrl')}
							name="sloUrl"
							value={sloUrl}
							hint={t('sloUrlHint')}
							onChange={(e) => setSloUrl(e.target.value)}
						/>
						<details className="evg-filters-panel evg-filters-panel--collapsible">
							<summary>{t('autofillSloFromMetadata')}</summary>
							<TextArea
								label={t('autofillSloFromMetadata')}
								value={sloMetadataXml}
								placeholder={t('autofillSloMetadataPlaceholder')}
								onChange={(e) => setSloMetadataXml(e.target.value)}
								rows={4}
							/>
							<Button
								type="button"
								variant="link"
								onClick={() => void handleAutofillSlo()}
								disabled={saving || sloMetadataXml.trim().length === 0}
							>
								{t('autofillSloApply')}
							</Button>
							{sloMetadataMessage ? <p className="evg-muted">{sloMetadataMessage}</p> : null}
						</details>
						<TextInput
							label={t('sloSoapUrl')}
							name="sloSoapUrl"
							value={sloSoapUrl}
							hint={t('sloSoapUrlHint')}
							onChange={(e) => setSloSoapUrl(e.target.value)}
						/>
						{sloSoapUrl.trim() ? (
							<>
								{!hasSpCertificate ? (
									<Callout variant="warning">{t('sloSoapUrlCertRequired')}</Callout>
								) : null}
								{/^http:\/\//i.test(sloSoapUrl.trim()) ? (
									<Callout variant="warning">{t('sloSoapUrlInsecure')}</Callout>
								) : null}
							</>
						) : null}
						{!isNew && id && sloSoapUrl.trim() && hasSpCertificate ? (
							<div className="evg-stack inline">
								<Button
									type="button"
									variant="secondary"
									disabled={saving || backchannelTestBusy}
									onClick={() => void handleTestBackchannel()}
								>
									{backchannelTestBusy ? t('testBackchannelBusy') : t('testBackchannel')}
								</Button>
								{backchannelTestMessage ? (
									<Callout variant={backchannelTestOk ? 'success' : 'danger'}>
										{backchannelTestMessage}
									</Callout>
								) : null}
							</div>
						) : null}
						<Select
							label={t('nameIdFormat')}
							value={nameIdFormat}
							onChange={(e) => setNameIdFormat(e.target.value)}
						>
							<option value="">{tCommon('defaultOption')}</option>
							{SAML_NAME_ID_FORMATS.map((format) => (
								<option key={format} value={format}>
									{format}
								</option>
							))}
						</Select>
						<Checkbox label={tCommon('active')} checked={active} onChange={setActive} />
						<Checkbox
							label={t('wantAssertionsEncrypted')}
							hint={t('wantAssertionsEncryptedHint')}
							checked={wantAssertionsEncrypted}
							onChange={setWantAssertionsEncrypted}
							disabled={saving || !hasSpCertificate}
						/>
						<Checkbox
							label={t('wantAuthnRequestsSigned')}
							hint={t('wantAuthnRequestsSignedHint')}
							checked={wantAuthnRequestsSigned}
							onChange={setWantAuthnRequestsSigned}
							disabled={saving || !hasSpCertificate}
						/>
						{wantAuthnRequestsSigned || hasSpCertificate ? (
							<>
								<Callout variant="info">{t('wantAuthnRequestsSignedCallout')}</Callout>
								<Callout variant="warning">{t('wantAuthnRequestsSignedMetadataHint')}</Callout>
							</>
						) : null}
						<Checkbox
							label={t('wantLogoutRequestsSigned')}
							hint={t('wantLogoutRequestsSignedHint')}
							checked={wantLogoutRequestsSigned}
							onChange={setWantLogoutRequestsSigned}
							disabled={saving || !hasSpCertificate}
						/>
						<AttributeMappingEditor
							value={attributeMapping}
							onChange={setAttributeMapping}
							disabled={saving}
						/>
						<TextArea
							label={t('spCertificatePem')}
							rows={4}
							hint={t('spCertificateHint')}
							value={spCertificate}
							onChange={(e) => {
								const value = e.target.value;
								setSpCertificate(value);
								setSpCertificateTouched(true);
								setHasStoredSpCertificate(value.trim().length > 0);
							}}
						/>
						{!isNew && id && hasSpCertificate ? (
							<details
								id="probe-sp-signing"
								className="evg-filters-panel evg-filters-panel--collapsible"
							>
								<summary>{t('probeSigningTitle')}</summary>
								<div className="evg-stack">
									<p className="evg-muted">{t('probeSigningHint')}</p>
									<TextArea
										label={t('probeSigningPrivateKeyPem')}
										rows={8}
										value={probeSpPrivateKeyPem}
										onChange={(event) => setProbeSpPrivateKeyPem(event.target.value)}
									/>
									<div className="evg-cluster">
										<Button
											type="button"
											variant="secondary"
											disabled={saving || probeSigningBusy || probeSpPrivateKeyPem.trim() === ''}
											onClick={() => void handleProbeSigning()}
										>
											{probeSigningBusy ? t('probeSigningButtonBusy') : t('probeSigningButton')}
										</Button>
									</div>
									{probeSigningMessage ? (
										<Callout variant="success">{probeSigningMessage}</Callout>
									) : null}
									{probeSigningError ? <ErrorBanner message={probeSigningError} /> : null}
								</div>
							</details>
						) : null}
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
						onClick={() => void handleTestAcs()}
					>
						{t('testAcs')}
					</Button>
					<Button
						type="button"
						variant="danger"
						disabled={saving}
						onClick={() => void handleDeactivateAndDelete()}
					>
						{t('deactivateAndDelete')}
					</Button>
					{acsTestMessage ? <span className="evg-muted"> — {acsTestMessage}</span> : null}
				</div>
			) : null}
			<p>
				<Link className="evg-btn evg-btn--link" to={SP_CONNECTION_ROUTE_PREFIX}>
					{t('backToList')}
				</Link>
			</p>
		</section>
	);
}
