import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX, identityRoleDetailRoute } from '@nestidp/shared';
import {
	AdminApiError,
	createIdentityRole,
	getIdentityRole,
	updateIdentityRole,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, ButtonLink, Panel, TextInput, useToast } from '../../ui';

export function IdentityRoleFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	useDocumentTitle(isNew ? 'New role — NestIdP Admin' : 'Edit role — NestIdP Admin');

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
					setError(err instanceof AdminApiError ? err.message : 'Failed to load role');
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
		setSaving(true);
		try {
			if (isNew) {
				const created = await createIdentityRole({ name: name.trim() });
				showToast('Role created');
				navigate(identityRoleDetailRoute(created.role.id));
			} else if (id) {
				const updated = await updateIdentityRole(id, { name: name.trim() });
				showToast('Role saved');
				navigate(identityRoleDetailRoute(updated.role.id));
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
				<ErrorBanner message="This role is managed by identity sync." />
				<p>
					<ButtonLink variant="link" to={identityRoleDetailRoute(id)}>
						View role
					</ButtonLink>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? 'Create manual role' : 'Edit manual role'}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Roles', to: `${IDENTITY_ROUTE_PREFIX}/roles` },
					{ label: isNew ? 'New' : name || 'Edit' },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title="Role">
					<TextInput
						label="Name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						requiredMark
						disabled={saving}
					/>
				</Panel>
				<p className="evg-actions">
					<Button type="submit" disabled={saving}>
						{isNew ? 'Create role' : 'Save'}
					</Button>
					<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/roles`}>
						Cancel
					</ButtonLink>
				</p>
			</form>
		</section>
	);
}
