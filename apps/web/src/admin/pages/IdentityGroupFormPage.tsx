import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, Panel, TextInput, useToast } from '../../ui';

export function IdentityGroupFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	useDocumentTitle(isNew ? 'New group — NestIdP Admin' : 'Edit group — NestIdP Admin');

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
					setError(err instanceof AdminApiError ? err.message : 'Failed to load group');
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
				const created = await createIdentityGroup({ name: name.trim() });
				showToast('Group created');
				navigate(identityGroupDetailRoute(created.group.id));
			} else if (id) {
				const updated = await updateIdentityGroup(id, { name: name.trim() });
				showToast('Group saved');
				navigate(identityGroupDetailRoute(updated.group.id));
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
				<ErrorBanner message="This group is managed by identity sync." />
				<p>
					<Link className="evg-btn evg-btn--link" to={identityGroupDetailRoute(id)}>
						View group
					</Link>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? 'Create manual group' : 'Edit manual group'}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Groups', to: `${IDENTITY_ROUTE_PREFIX}/groups` },
					{ label: isNew ? 'New' : name || 'Edit' },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title="Group">
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
						{isNew ? 'Create group' : 'Save'}
					</Button>
					<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/groups`}>
						Cancel
					</Link>
				</p>
			</form>
		</section>
	);
}
