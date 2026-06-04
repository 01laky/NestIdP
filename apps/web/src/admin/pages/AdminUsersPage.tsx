import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	changeAdminPassword,
	createAdminUser,
	deleteAdminUser,
	getAdminMe,
	listAdminUsers,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, Panel, Table, TextInput, useConfirmAction, useToast } from '../../ui';

export function AdminUsersPage() {
	const { t } = useTranslation('adminUsers');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { t: tErrors } = useTranslation('errors');
	const confirmAction = useConfirmAction();
	useAdminDocumentTitle(t('title'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [admins, setAdmins] = useState<Awaited<ReturnType<typeof listAdminUsers>>>([]);
	const [meId, setMeId] = useState<string | null>(null);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [currentPassword, setCurrentPassword] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
	const [creating, setCreating] = useState(false);
	const [changingPassword, setChangingPassword] = useState(false);
	const { showToast } = useToast();

	async function reload() {
		const [users, me] = await Promise.all([listAdminUsers(), getAdminMe()]);
		setAdmins(users);
		setMeId(me.admin.id);
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
									'adminUsers.loadFailed',
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

	async function handleCreate(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (password !== confirmPassword) {
			setError(tErrors('passwordsDoNotMatch'));
			return;
		}
		setCreating(true);
		try {
			await createAdminUser({ username, password });
			setUsername('');
			setPassword('');
			setConfirmPassword('');
			await reload();
			showToast(t('toastAdminCreated'));
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'adminUsers.createFailed',
						)
					: t('createFailed'),
			);
		} finally {
			setCreating(false);
		}
	}

	async function handleChangeMyPassword(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (newPassword !== newPasswordConfirm) {
			setError(tErrors('newPasswordsDoNotMatch'));
			return;
		}
		setChangingPassword(true);
		try {
			await changeAdminPassword({ currentPassword, newPassword });
			setCurrentPassword('');
			setNewPassword('');
			setNewPasswordConfirm('');
			showToast(t('toastPasswordChanged'));
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'adminUsers.passwordChangeFailed',
						)
					: t('passwordChangeFailed'),
			);
		} finally {
			setChangingPassword(false);
		}
	}

	return (
		<section>
			<AdminPageHeader
				title={t('title')}
				subtitle={t('subtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('title') }]}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading ? (
				<>
					<div className="evg-table-wrap">
						<Table>
							<thead>
								<tr>
									<th>{tCommon('username')}</th>
									<th>{tCommon('created')}</th>
									<th>{tCommon('actions')}</th>
								</tr>
							</thead>
							<tbody>
								{admins.map((admin) => (
									<tr key={admin.id}>
										<td>{admin.username}</td>
										<td className="evg-muted">{new Date(admin.createdAt).toLocaleString()}</td>
										<td>
											{admin.id !== meId && admins.length > 1 ? (
												<Button
													type="button"
													size="sm"
													variant="danger"
													onClick={() => {
														void confirmAction({
															title: t('confirmDeleteAdminTitle'),
															description: t('confirmDeleteAdmin', {
																username: admin.username,
															}),
															tone: 'danger',
															showAuditNote: true,
															confirmLabel: tCommon('delete'),
															onConfirm: async () => {
																await deleteAdminUser(admin.id);
																await reload();
															},
														});
													}}
												>
													{tCommon('delete')}
												</Button>
											) : (
												<span className="evg-muted">{tCommon('emDash')}</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</Table>
					</div>

					<Panel title={t('createAdmin')}>
						<form className="evg-stack" aria-busy={creating} onSubmit={(e) => void handleCreate(e)}>
							<fieldset className="evg-stack" disabled={creating}>
								<TextInput
									label={tCommon('username')}
									name="username"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label={tCommon('password')}
									name="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label={tCommon('confirmPassword')}
									name="confirmPassword"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									required
									requiredMark
								/>
								<Button type="submit" variant="primary" disabled={creating}>
									{creating ? tCommon('creating') : t('createAdmin')}
								</Button>
							</fieldset>
						</form>
					</Panel>

					<Panel title={t('changeMyPassword')} id="change-password">
						<form
							className="evg-stack"
							aria-busy={changingPassword}
							onSubmit={(e) => void handleChangeMyPassword(e)}
						>
							<p className="evg-muted">{t('changePasswordHint')}</p>
							<fieldset className="evg-stack" disabled={changingPassword}>
								<TextInput
									label={tCommon('currentPassword')}
									name="currentPassword"
									type="password"
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label={tCommon('newPassword')}
									name="newPassword"
									type="password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label={tCommon('confirmNewPassword')}
									name="newPasswordConfirm"
									type="password"
									value={newPasswordConfirm}
									onChange={(e) => setNewPasswordConfirm(e.target.value)}
									required
									requiredMark
								/>
								<Button type="submit" variant="primary" disabled={changingPassword}>
									{changingPassword ? tCommon('updating') : t('updateMyPassword')}
								</Button>
							</fieldset>
						</form>
					</Panel>
				</>
			) : null}
			<p className="evg-muted">
				<Link className="evg-btn evg-btn--link" to={ADMIN_USERS_ROUTE_PREFIX}>
					{tCommon('refresh')}
				</Link>
			</p>
		</section>
	);
}
