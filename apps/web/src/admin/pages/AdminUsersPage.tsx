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
import { Panel, Table, useToast } from '../../ui';

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
		try {
			await createAdminUser({ username, password });
			setUsername('');
			setPassword('');
			setConfirmPassword('');
			await reload();
			showToast('Admin account created');
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Create failed');
		}
	}

	async function handleChangeMyPassword(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (newPassword !== newPasswordConfirm) {
			setError('New passwords do not match');
			return;
		}
		try {
			await changeAdminPassword({ currentPassword, newPassword });
			setCurrentPassword('');
			setNewPassword('');
			setNewPasswordConfirm('');
			showToast('Password changed');
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Password change failed');
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
											<button
												type="button"
												className="evg-btn evg-btn--link evg-btn--danger"
												onClick={() => {
													if (window.confirm(`Delete admin "${admin.username}"?`)) {
														void deleteAdminUser(admin.id).then(() => reload());
													}
												}}
											>
												Delete
											</button>
										) : (
											<span className="evg-muted">—</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</Table>

					<Panel title="Create admin">
						<form className="evg-stack" onSubmit={(e) => void handleCreate(e)}>
							<h2>Create admin</h2>
							<label>
								Username
								<input value={username} onChange={(e) => setUsername(e.target.value)} required />
							</label>
							<label>
								Password
								<input
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
								/>
							</label>
							<label>
								Confirm password
								<input
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									required
								/>
							</label>
							<button type="submit" className="evg-btn evg-btn--primary">
								Create admin
							</button>
						</form>
					</Panel>

					<Panel title="Change my password" id="change-password">
						<form className="evg-stack" onSubmit={(e) => void handleChangeMyPassword(e)}>
							<p className="evg-muted">
								Uses a separate endpoint; other admins can reset your password via PATCH without
								knowing your current password.
							</p>
							<label>
								Current password
								<input
									type="password"
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
									required
								/>
							</label>
							<label>
								New password
								<input
									type="password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									required
								/>
							</label>
							<label>
								Confirm new password
								<input
									type="password"
									value={newPasswordConfirm}
									onChange={(e) => setNewPasswordConfirm(e.target.value)}
									required
								/>
							</label>
							<button type="submit" className="evg-btn evg-btn--primary">
								Update my password
							</button>
						</form>
					</Panel>
				</>
			) : null}
			<p className="evg-muted">
				<Link to={ADMIN_USERS_ROUTE_PREFIX}>Refresh</Link>
			</p>
		</section>
	);
}
