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
	testSpConnectionAcs,
	updateSpConnection,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { AttributeMappingEditor } from '../components/AttributeMappingEditor';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, Checkbox, Panel, Select, TextArea, TextInput, useToast } from '../../ui';

export function SpConnectionFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(isNew ? t('formNew') : t('formEdit'));
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [spEntityId, setSpEntityId] = useState('');
	const [acsUrl, setAcsUrl] = useState('');
	const [nameIdFormat, setNameIdFormat] = useState('');
	const [active, setActive] = useState(true);
	const [attributeMapping, setAttributeMapping] = useState<SpAttributeMappingConfig | null>(null);
	const [spCertificate, setSpCertificate] = useState('');
	const [acsTestMessage, setAcsTestMessage] = useState<string | null>(null);
	const { showToast } = useToast();
	const [saving, setSaving] = useState(false);

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
					setNameIdFormat(item.nameIdFormat);
					setActive(item.active);
					setAttributeMapping(item.attributeMapping);
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

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		const body = {
			name,
			spEntityId,
			acsUrl,
			nameIdFormat: nameIdFormat || undefined,
			active,
			attributeMapping,
			spCertificate: spCertificate.trim() ? spCertificate.trim() : null,
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

	async function handleDeactivateAndDelete() {
		if (!id) {
			return;
		}
		if (!window.confirm(t('confirmDeactivateDelete'))) {
			return;
		}
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
							onChange={(e) => setSpCertificate(e.target.value)}
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
