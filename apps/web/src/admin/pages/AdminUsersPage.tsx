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
					<table className="admin-table">
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
									<td className="muted">{new Date(admin.createdAt).toLocaleString()}</td>
									<td>
										{admin.id !== meId && admins.length > 1 ? (
											<button
												type="button"
												className="button-link danger"
												onClick={() => {
													if (window.confirm(`Delete admin "${admin.username}"?`)) {
														void deleteAdminUser(admin.id).then(() => reload());
													}
												}}
											>
												Delete
											</button>
										) : (
											<span className="muted">—</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>

					<form className="admin-form" onSubmit={(e) => void handleCreate(e)}>
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
						<button type="submit">Create admin</button>
					</form>

					<form className="admin-form" onSubmit={(e) => void handleChangeMyPassword(e)}>
						<h2>Change my password</h2>
						<p className="muted">
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
						<button type="submit">Update my password</button>
					</form>
				</>
			) : null}
			<p className="muted">
				<Link to={ADMIN_USERS_ROUTE_PREFIX}>Refresh</Link>
			</p>
		</section>
	);
}
