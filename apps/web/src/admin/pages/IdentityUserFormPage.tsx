import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	identityUserDetailRoute,
} from '@nestidp/shared';
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
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, Checkbox, Panel, TextInput, useToast } from '../../ui';

export function IdentityUserFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	useDocumentTitle(isNew ? 'New manual user — NestIdP Admin' : 'Edit manual user — NestIdP Admin');

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
					setError(err instanceof AdminApiError ? err.message : 'Failed to load user');
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
	}, [id, isNew]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		if (readOnlySynced) {
			return;
		}
		if (isNew) {
			if (password !== confirmPassword) {
				setError('Passwords do not match');
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
				showToast('Manual user created');
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
				showToast('User saved');
				navigate(identityUserDetailRoute(updated.user.id));
			}
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Save failed');
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
				<ErrorBanner message="This user is managed by identity sync and cannot be edited here." />
				<p>
					<Link className="evg-btn evg-btn--link" to={identityUserDetailRoute(id)}>
						View user
					</Link>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? 'Create manual user' : 'Edit manual user'}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Users', to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: isNew ? 'New' : username || 'Edit' },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title="Account">
					<TextInput
						label="Username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						requiredMark
						disabled={saving}
					/>
					<TextInput
						label="Email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={saving}
					/>
					<TextInput
						label="Display name"
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						disabled={saving}
					/>
					<Checkbox label="Active" checked={active} onChange={setActive} disabled={saving} />
				</Panel>
				<Panel title={isNew ? 'Password' : 'Password (optional)'}>
					<TextInput
						label="Password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						requiredMark={isNew}
						disabled={saving}
					/>
					{isNew ? (
						<TextInput
							label="Confirm password"
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
						{isNew ? 'Create user' : 'Save'}
					</Button>
					<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
						Cancel
					</Link>
				</p>
			</form>
			{isNew ? (
				<p className="evg-muted">
					Already have synced users? They are read-only — use{' '}
					<Link to={IDENTITY_USER_NEW_ROUTE}>manual users</Link> for break-glass access only.
				</p>
			) : null}
		</section>
	);
}
