import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDENTITY_ROUTE_PREFIX, identityGroupDetailRoute } from '@nestidp/shared';
import {
	AdminApiError,
	createIdentityGroup,
	getIdentityGroup,
	updateIdentityGroup,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, ButtonLink, Panel, TextInput, useToast } from '../../ui';

export function IdentityGroupFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(isNew ? t('formNewGroup') : t('formEditGroup'));
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [readOnlySynced, setReadOnlySynced] = useState(false);
	const [name, setName] = useState('');
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getIdentityGroup(id);
				if (cancelled) {
					return;
				}
				if (data.group.origin !== 'manual') {
					setReadOnlySynced(true);
				}
				setName(data.group.name);
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadGroupFailed',
								)
							: t('loadGroupFailed'),
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
		setError(null);
		if (readOnlySynced) {
			return;
		}
		setSaving(true);
		try {
			if (isNew) {
				const created = await createIdentityGroup({ name: name.trim() });
				showToast(t('toastGroupCreated'));
				navigate(identityGroupDetailRoute(created.group.id));
			} else if (id) {
				const updated = await updateIdentityGroup(id, { name: name.trim() });
				showToast(t('toastGroupSaved'));
				navigate(identityGroupDetailRoute(updated.group.id));
			}
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'errors.saveFailed')
					: resolveI18nKey('errors.saveFailed'),
			);
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	if (readOnlySynced && id) {
		return (
			<section>
				<ErrorBanner message={t('managedBySyncGroup')} />
				<p>
					<ButtonLink variant="link" to={identityGroupDetailRoute(id)}>
						{t('viewGroup')}
					</ButtonLink>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? t('formNewGroup') : t('formEditGroup')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('groups'), to: `${IDENTITY_ROUTE_PREFIX}/groups` },
					{ label: isNew ? tCommon('new') : name || tCommon('edit') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title={t('groupPanel')}>
					<TextInput
						label={tCommon('name')}
						value={name}
						onChange={(e) => setName(e.target.value)}
						requiredMark
						disabled={saving}
					/>
				</Panel>
				<p className="evg-actions">
					<Button type="submit" disabled={saving}>
						{isNew ? t('createGroup') : tCommon('save')}
					</Button>
					<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/groups`}>
						{tCommon('cancel')}
					</ButtonLink>
				</p>
			</form>
		</section>
	);
}
