import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDENTITY_ROLE_NEW_ROUTE, identityRoleDetailRoute } from '@nestidp/shared';
import { AdminApiError, listIdentityRoles } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../i18n/enum-labels';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Select, Table } from '../../ui';

export function IdentityRolesPage() {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('rolesTitle'));
	const [loading, setLoading] = useState(true);
	const [filterBusy, setFilterBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityRoles>>['items']>([]);

	async function load(originFilter: string, options?: { fromFilter?: boolean }) {
		if (options?.fromFilter) {
			setFilterBusy(true);
		}
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityRoles({
				limit: 100,
				origin: originFilter || undefined,
			});
			setItems(data.items);
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'identity.loadRolesFailed',
						)
					: t('loadRolesFailed'),
			);
		} finally {
			setLoading(false);
			setFilterBusy(false);
		}
	}

	useEffect(() => {
		void load('');
	}, []);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		void load(origin, { fromFilter: true });
	}

	const filterDisabled = filterBusy;

	return (
		<section>
			<AdminPageHeader
				title={t('rolesTitle')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tCommon('identity') },
					{ label: tNav('roles') },
				]}
				actions={
					<ButtonLink to={IDENTITY_ROLE_NEW_ROUTE} variant="primary">
						{t('createManualRole')}
					</ButtonLink>
				}
			/>
			<form
				className="evg-inline-form"
				aria-label={t('filterRoles')}
				aria-busy={filterBusy}
				onSubmit={handleFilter}
			>
				<Select
					label={tCommon('origin')}
					fieldClassName="evg-field--fixed"
					value={origin}
					onChange={(e) => setOrigin(e.target.value)}
					disabled={filterDisabled}
				>
					<option value="">{identityOriginFilterLabel('', resolveI18nKey)}</option>
					<option value="manual">{identityOriginFilterLabel('manual', resolveI18nKey)}</option>
					<option value="synced">{identityOriginFilterLabel('synced', resolveI18nKey)}</option>
				</Select>
				<Button type="submit" variant="secondary" disabled={filterDisabled}>
					{tCommon('apply')}
				</Button>
			</form>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error ? (
				<div className="evg-table-wrap">
					<Table>
						<thead>
							<tr>
								<th>{tCommon('name')}</th>
								<th>{tCommon('origin')}</th>
								<th>{tCommon('members')}</th>
							</tr>
						</thead>
						<tbody>
							{items.map((role) => (
								<tr key={role.id}>
									<td>
										<Link to={identityRoleDetailRoute(role.id)}>{role.name}</Link>
									</td>
									<td>
										<Badge variant={identityOriginToBadge(role.origin)}>
											{identityOriginLabel(role.origin)}
										</Badge>
									</td>
									<td>{role.memberCount ?? tCommon('emDash')}</td>
								</tr>
							))}
						</tbody>
					</Table>
				</div>
			) : null}
			<IdentitySectionNav current="roles" />
		</section>
	);
}
