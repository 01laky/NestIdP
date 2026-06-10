import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDENTITY_ROUTE_PREFIX, identityRoleDetailRoute } from '@nestidp/shared';
import { createIdentityRole, getIdentityRole, updateIdentityRole } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../i18n/api-error-messages';
import { Button, ButtonLink, Panel, TextInput, useToast } from '../../ui';

export function IdentityRoleFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(isNew ? t('formNewRole') : t('formEditRole'));
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
				const data = await getIdentityRole(id);
				if (cancelled) {
					return;
				}
				if (data.role.origin !== 'manual') {
					setReadOnlySynced(true);
				}
				setName(data.role.name);
			} catch (err) {
				if (!cancelled) {
					setError(mapAdminError(err, 'identity.loadRoleFailed'));
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
				const created = await createIdentityRole({ name: name.trim() });
				showToast(t('toastRoleCreated'));
				navigate(identityRoleDetailRoute(created.role.id));
			} else if (id) {
				const updated = await updateIdentityRole(id, { name: name.trim() });
				showToast(t('toastRoleSaved'));
				navigate(identityRoleDetailRoute(updated.role.id));
			}
		} catch (err) {
			setError(mapAdminError(err, 'errors.saveFailed'));
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
				<ErrorBanner message={t('managedBySyncRole')} />
				<p>
					<ButtonLink variant="link" to={identityRoleDetailRoute(id)}>
						{t('viewRole')}
					</ButtonLink>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? t('formNewRole') : t('formEditRole')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('roles'), to: `${IDENTITY_ROUTE_PREFIX}/roles` },
					{ label: isNew ? tCommon('new') : name || tCommon('edit') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title={t('rolePanel')}>
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
						{isNew ? t('createRole') : tCommon('save')}
					</Button>
					<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/roles`}>
						{tCommon('cancel')}
					</ButtonLink>
				</p>
			</form>
		</section>
	);
}
