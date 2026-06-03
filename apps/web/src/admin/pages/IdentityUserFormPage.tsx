import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDENTITY_ROUTE_PREFIX, identityUserDetailRoute } from '@nestidp/shared';
import {
	AdminApiError,
	createIdentityUser,
	getIdentityUser,
	updateIdentityUser,
} from '../adminApi';
import { IdentityMembershipPicker } from '../components/IdentityMembershipPicker';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, ButtonLink, Checkbox, Panel, TextInput, useToast } from '../../ui';

export function IdentityUserFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { t: tErrors } = useTranslation('errors');
	useAdminDocumentTitle(isNew ? t('formNewUser') : t('formEditUser'));
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [readOnlySynced, setReadOnlySynced] = useState(false);
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [active, setActive] = useState(true);
	const [groupIds, setGroupIds] = useState<string[]>([]);
	const [roleIds, setRoleIds] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getIdentityUser(id);
				if (cancelled) {
					return;
				}
				if (data.user.origin !== 'manual') {
					setReadOnlySynced(true);
				}
				setUsername(data.user.username);
				setEmail(data.user.email ?? '');
				setDisplayName(data.user.displayName ?? '');
				setActive(data.user.active);
				setGroupIds(data.groups.map((g) => g.id));
				setRoleIds(data.roles.map((r) => r.id));
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadUserFailed',
								)
							: t('loadUserFailed'),
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
		if (isNew) {
			if (password !== confirmPassword) {
				setError(tErrors('passwordsDoNotMatch'));
				return;
			}
		}
		setSaving(true);
		try {
			if (isNew) {
				const created = await createIdentityUser({
					username: username.trim(),
					email: email.trim() || null,
					displayName: displayName.trim() || null,
					password,
					confirmPassword,
					active,
					groupIds,
					roleIds,
				});
				showToast(t('toastUserCreated'));
				navigate(identityUserDetailRoute(created.user.id));
			} else if (id) {
				const body: Parameters<typeof updateIdentityUser>[1] = {
					username: username.trim(),
					email: email.trim() || null,
					displayName: displayName.trim() || null,
					active,
					groupIds,
					roleIds,
				};
				if (password.trim()) {
					body.password = password;
				}
				const updated = await updateIdentityUser(id, body);
				showToast(t('toastUserSaved'));
				navigate(identityUserDetailRoute(updated.user.id));
			}
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'errors.saveFailed')
					: tErrors('saveFailed'),
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
				<ErrorBanner message={t('managedBySyncUser')} />
				<p>
					<ButtonLink variant="link" to={identityUserDetailRoute(id)}>
						{t('viewUser')}
					</ButtonLink>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? t('formNewUser') : t('formEditUser')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('users'), to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: isNew ? tCommon('new') : username || tCommon('edit') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title={t('accountPanel')}>
					<TextInput
						label={tCommon('username')}
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						requiredMark
						disabled={saving}
					/>
					<TextInput
						label={tCommon('email')}
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={saving}
					/>
					<TextInput
						label={tCommon('displayName')}
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						disabled={saving}
					/>
					<Checkbox
						label={tCommon('active')}
						checked={active}
						onChange={setActive}
						disabled={saving}
					/>
				</Panel>
				<Panel title={isNew ? t('passwordPanel') : t('passwordOptionalPanel')}>
					<TextInput
						label={tCommon('password')}
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						requiredMark={isNew}
						disabled={saving}
					/>
					{isNew ? (
						<TextInput
							label={tCommon('confirmPassword')}
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							requiredMark
							disabled={saving}
						/>
					) : null}
				</Panel>
				<IdentityMembershipPicker
					groupIds={groupIds}
					roleIds={roleIds}
					onGroupIdsChange={setGroupIds}
					onRoleIdsChange={setRoleIds}
					disabled={saving}
				/>
				<p className="evg-actions">
					<Button type="submit" disabled={saving}>
						{isNew ? t('createUser') : tCommon('save')}
					</Button>
					<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
						{tCommon('cancel')}
					</ButtonLink>
				</p>
			</form>
			{isNew ? <p className="evg-muted">{t('breakGlassHint')}</p> : null}
		</section>
	);
}
