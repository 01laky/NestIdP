import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
	SpAttributeMappingConfig,
	SpMetadataAcsOption,
	SpMetadataImportResponseDto,
	SpMetadataWarning,
} from '@nestidp/shared';
import { SAML_NAME_ID_FORMATS, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	createSpConnection,
	deleteSpConnection,
	fetchSpMetadataFromUrl,
	getSpConnection,
	parseSpMetadata,
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
import { mapAdminError } from '../../i18n/api-error-messages';
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
	const [importMode, setImportMode] = useState<'paste' | 'url'>('paste');
	const [importXml, setImportXml] = useState('');
	const [importUrl, setImportUrl] = useState('');
	const [importBusy, setImportBusy] = useState(false);
	const [importMessage, setImportMessage] = useState<string | null>(null);
	const [importMessageOk, setImportMessageOk] = useState(false);
	const [importWarnings, setImportWarnings] = useState<SpMetadataWarning[]>([]);
	const [importConflict, setImportConflict] =
		useState<SpMetadataImportResponseDto['entityIdConflict']>(null);
	const [acsOptions, setAcsOptions] = useState<SpMetadataAcsOption[]>([]);
	const [importedSource, setImportedSource] = useState<'metadata_xml' | 'metadata_url' | null>(
		null,
	);
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
					setError(mapAdminError(err, 'spConnections.loadFailed'));
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
			...(importedSource ? { importSource: importedSource } : {}),
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
			setError(mapAdminError(err, 'spConnections.saveFailed'));
		} finally {
			setSaving(false);
		}
	}

	function applyImport(result: SpMetadataImportResponseDto) {
		if (result.entityId) {
			setSpEntityId(result.entityId);
		}
		setAcsOptions(result.acsOptions);
		if (result.acsUrl) {
			setAcsUrl(result.acsUrl);
		}
		if (result.sloUrl) {
			setSloUrl(result.sloUrl);
		}
		if (result.sloSoapUrl) {
			setSloSoapUrl(result.sloSoapUrl);
		}
		if (result.nameIdFormat) {
			setNameIdFormat(result.nameIdFormat);
		}
		if (result.spCertificate) {
			setSpCertificate(result.spCertificate);
			setSpCertificateTouched(true);
			setHasStoredSpCertificate(true);
			// Only suggest "require signed AuthnRequest" when a usable cert came with it.
			if (result.authnRequestsSigned) {
				setWantAuthnRequestsSigned(true);
			}
		}
		setImportWarnings(result.warnings);
		setImportConflict(result.entityIdConflict);
		setImportedSource(importMode === 'paste' ? 'metadata_xml' : 'metadata_url');
		setImportMessageOk(true);
		setImportMessage(t('import.success'));
	}

	async function runImport(): Promise<SpMetadataImportResponseDto | null> {
		setImportBusy(true);
		setImportMessage(null);
		setImportMessageOk(false);
		try {
			const result =
				importMode === 'paste'
					? await parseSpMetadata(importXml)
					: await fetchSpMetadataFromUrl(importUrl);
			if (!result.valid) {
				setImportWarnings([]);
				setImportConflict(null);
				setImportMessageOk(false);
				setImportMessage(t('import.notSpMetadata'));
				return null;
			}
			return result;
		} catch (err) {
			setImportMessageOk(false);
			setImportMessage(mapAdminError(err, 'spConnections.import.failed'));
			return null;
		} finally {
			setImportBusy(false);
		}
	}

	async function handleImport() {
		const result = await runImport();
		if (!result) {
			return;
		}
		// On the edit form the import is a reviewed refresh — confirm before overwriting fields, and
		// spell out which fields would change (especially a rotated signing certificate).
		if (!isNew) {
			const changed: string[] = [];
			if (result.entityId && result.entityId !== spEntityId) changed.push(t('spEntityId'));
			if (result.acsUrl && result.acsUrl !== acsUrl) changed.push(t('acsUrl'));
			if (result.sloUrl && result.sloUrl !== sloUrl) changed.push(t('sloUrl'));
			if (result.sloSoapUrl && result.sloSoapUrl !== sloSoapUrl) changed.push(t('sloSoapUrl'));
			if (result.nameIdFormat && result.nameIdFormat !== nameIdFormat)
				changed.push(t('nameIdFormat'));
			if (result.spCertificate) changed.push(t('spCertificatePem'));
			const description = changed.length
				? `${t('import.refreshDescription')} — ${changed.join(', ')}`
				: t('import.refreshDescription');
			await confirmAction({
				title: t('import.refreshTitle'),
				description,
				confirmLabel: tCommon('apply'),
				onConfirm: async () => {
					applyImport(result);
				},
			});
			return;
		}
		applyImport(result);
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
					setError(mapAdminError(err, 'spConnections.deleteFailed'));
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
			setAcsTestMessage(mapAdminError(err, 'spConnections.acsTestFailed'));
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
			setBackchannelTestMessage(mapAdminError(err, 'spConnections.testBackchannelFailedGeneric'));
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
			setProbeSigningError(mapAdminError(err, 'spConnections.probeSigningFailed'));
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
						<div className="evg-filters-panel">
							<h3 className="evg-section-title">{t('import.panelTitle')}</h3>
							<p className="evg-muted">{t('import.intro')}</p>
							<div className="evg-stack inline" role="group">
								<Button
									type="button"
									variant={importMode === 'paste' ? 'secondary' : 'link'}
									onClick={() => setImportMode('paste')}
								>
									{t('import.modePaste')}
								</Button>
								<Button
									type="button"
									variant={importMode === 'url' ? 'secondary' : 'link'}
									onClick={() => setImportMode('url')}
								>
									{t('import.modeUrl')}
								</Button>
							</div>
							{importMode === 'paste' ? (
								<TextArea
									label={t('import.xmlLabel')}
									name="importXml"
									value={importXml}
									placeholder={t('import.xmlPlaceholder')}
									onChange={(e) => setImportXml(e.target.value)}
									rows={5}
								/>
							) : (
								<TextInput
									label={t('import.urlLabel')}
									name="importUrl"
									value={importUrl}
									placeholder={t('import.urlPlaceholder')}
									onChange={(e) => setImportUrl(e.target.value)}
								/>
							)}
							<Button
								type="button"
								variant="secondary"
								disabled={
									importBusy ||
									(importMode === 'paste'
										? importXml.trim().length === 0
										: importUrl.trim().length === 0)
								}
								onClick={() => void handleImport()}
							>
								{importBusy
									? t('import.busy')
									: importMode === 'paste'
										? t('import.parseButton')
										: t('import.fetchButton')}
							</Button>
							{importMessage ? (
								<Callout variant={importMessageOk ? 'success' : 'warning'}>{importMessage}</Callout>
							) : null}
							{importConflict ? (
								<Callout variant="warning">
									{t('import.conflictMessage', { name: importConflict.name })}{' '}
									<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${importConflict.id}`}>
										{t('import.conflictLink')}
									</Link>
								</Callout>
							) : null}
							{importWarnings.map((w) => (
								<Callout key={w.code} variant="warning">
									{t(`import.warnings.${w.code}`, { detail: w.detail ?? '' })}
								</Callout>
							))}
						</div>
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
						{acsOptions.length > 1 ? (
							<Select
								label={t('import.acsPickerLabel')}
								value={acsUrl}
								onChange={(e) => setAcsUrl(e.target.value)}
							>
								{acsOptions.map((option) => (
									<option key={option.location} value={option.location}>
										{`${option.location} (${option.binding.split(':').pop()})`}
									</option>
								))}
							</Select>
						) : null}
						<TextInput
							label={t('sloUrl')}
							name="sloUrl"
							value={sloUrl}
							hint={t('sloUrlHint')}
							onChange={(e) => setSloUrl(e.target.value)}
						/>
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
							id="encrypt-saml-assertions"
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
