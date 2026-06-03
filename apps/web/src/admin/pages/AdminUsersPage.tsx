import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, Panel, Table, TextInput, useToast } from '../../ui';

export function AdminUsersPage() {
	useDocumentTitle('Admin accounts — NestIdP Admin');
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
					setError(err instanceof AdminApiError ? err.message : 'Failed to load admins');
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
	}, []);

	async function handleCreate(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (password !== confirmPassword) {
			setError('Passwords do not match');
			return;
		}
		setCreating(true);
		try {
			await createAdminUser({ username, password });
			setUsername('');
			setPassword('');
			setConfirmPassword('');
			await reload();
			showToast('Admin account created');
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Create failed');
		} finally {
			setCreating(false);
		}
	}

	async function handleChangeMyPassword(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (newPassword !== newPasswordConfirm) {
			setError('New passwords do not match');
			return;
		}
		setChangingPassword(true);
		try {
			await changeAdminPassword({ currentPassword, newPassword });
			setCurrentPassword('');
			setNewPassword('');
			setNewPasswordConfirm('');
			showToast('Password changed');
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Password change failed');
		} finally {
			setChangingPassword(false);
		}
	}

	return (
		<section>
			<AdminPageHeader
				title="Admin accounts"
				subtitle="Operator accounts for this IdP (separate from synced SAML users)"
				breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Admin accounts' }]}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading ? (
				<>
					<Table>
						<thead>
							<tr>
								<th>Username</th>
								<th>Created</th>
								<th>Actions</th>
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
													if (window.confirm(`Delete admin "${admin.username}"?`)) {
														void deleteAdminUser(admin.id).then(() => reload());
													}
												}}
											>
												Delete
											</Button>
										) : (
											<span className="evg-muted">—</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</Table>

					<Panel title="Create admin">
						<form className="evg-stack" aria-busy={creating} onSubmit={(e) => void handleCreate(e)}>
							<fieldset className="evg-stack" disabled={creating}>
								<TextInput
									label="Username"
									name="username"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label="Password"
									name="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label="Confirm password"
									name="confirmPassword"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									required
									requiredMark
								/>
								<Button type="submit" variant="primary" disabled={creating}>
									{creating ? 'Creating…' : 'Create admin'}
								</Button>
							</fieldset>
						</form>
					</Panel>

					<Panel title="Change my password" id="change-password">
						<form
							className="evg-stack"
							aria-busy={changingPassword}
							onSubmit={(e) => void handleChangeMyPassword(e)}
						>
							<p className="evg-muted">
								Uses a separate endpoint; other admins can reset your password via PATCH without
								knowing your current password.
							</p>
							<fieldset className="evg-stack" disabled={changingPassword}>
								<TextInput
									label="Current password"
									name="currentPassword"
									type="password"
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label="New password"
									name="newPassword"
									type="password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									required
									requiredMark
								/>
								<TextInput
									label="Confirm new password"
									name="newPasswordConfirm"
									type="password"
									value={newPasswordConfirm}
									onChange={(e) => setNewPasswordConfirm(e.target.value)}
									required
									requiredMark
								/>
								<Button type="submit" variant="primary" disabled={changingPassword}>
									{changingPassword ? 'Updating…' : 'Update my password'}
								</Button>
							</fieldset>
						</form>
					</Panel>
				</>
			) : null}
			<p className="evg-muted">
				<Link className="evg-btn evg-btn--link" to={ADMIN_USERS_ROUTE_PREFIX}>
					Refresh
				</Link>
			</p>
		</section>
	);
}
