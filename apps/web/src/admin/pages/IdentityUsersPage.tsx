import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
} from '@nestidp/shared';
import { AdminApiError, listIdentityUsers } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../i18n/enum-labels';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Panel, Select, Table, TextInput } from '../../ui';

export function IdentityUsersPage() {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('usersTitle'));
	const [loading, setLoading] = useState(true);
	const [filterBusy, setFilterBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityUsers>>['items']>([]);
	const [total, setTotal] = useState(0);

	async function load(query: string, originFilter: string, options?: { fromFilter?: boolean }) {
		if (options?.fromFilter) {
			setFilterBusy(true);
		}
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityUsers({
				search: query || undefined,
				origin: originFilter || undefined,
				limit: 50,
			});
			setItems(data.items);
			setTotal(data.total);
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'identity.loadUsersFailed',
						)
					: t('loadUsersFailed'),
			);
		} finally {
			setLoading(false);
			setFilterBusy(false);
		}
	}

	useEffect(() => {
		void load('', '');
	}, []);

	function handleSearch(event: FormEvent) {
		event.preventDefault();
		void load(search, origin, { fromFilter: true });
	}

	const filterDisabled = filterBusy;

	return (
		<section>
			<AdminPageHeader
				title={t('usersTitle')}
				subtitle={tCommon('total', { count: total })}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tCommon('identity'), to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: tNav('users') },
				]}
				actions={
					<ButtonLink to={IDENTITY_USER_NEW_ROUTE} variant="primary">
						{t('createManualUser')}
					</ButtonLink>
				}
			/>
			<Panel title={t('calloutTitle')} className="evg-identity-callout">
				<p>{t('calloutBody')}</p>
				<p>
					<Link to={API_CONNECTION_ROUTE_PREFIX}>{tNav('apiConnections')}</Link>
					{' · '}
					<Link to={IDENTITY_USER_NEW_ROUTE}>{t('createManualUser')}</Link>
				</p>
			</Panel>
			<form
				className="evg-inline-form"
				role="search"
				aria-label={t('filterUsers')}
				aria-busy={filterBusy}
				onSubmit={handleSearch}
			>
				<TextInput
					label={tCommon('search')}
					fieldClassName="evg-field--grow"
					placeholder={t('searchPlaceholder')}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					disabled={filterDisabled}
				/>
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
			{!loading && !error && items.length === 0 ? (
				<EmptyState
					title={t('noUsers')}
					description={t('noUsersDescription')}
					action={
						<ButtonLink to={IDENTITY_USER_NEW_ROUTE} variant="primary">
							{t('createManualUser')}
						</ButtonLink>
					}
				/>
			) : null}
			{!loading && !error && items.length > 0 ? (
				<div className="evg-table-wrap">
					<Table>
						<thead>
							<tr>
								<th>{tCommon('username')}</th>
								<th>{tCommon('email')}</th>
								<th>{tCommon('origin')}</th>
								<th>{t('tableActive')}</th>
							</tr>
						</thead>
						<tbody>
							{items.map((user) => (
								<tr key={user.id}>
									<td>
										<Link to={`${IDENTITY_ROUTE_PREFIX}/users/${user.id}`}>{user.username}</Link>
									</td>
									<td>{user.email ?? tCommon('emDash')}</td>
									<td>
										<Badge variant={identityOriginToBadge(user.origin)}>
											{identityOriginLabel(user.origin)}
										</Badge>
									</td>
									<td>{user.active ? tCommon('yes') : tCommon('no')}</td>
								</tr>
							))}
						</tbody>
					</Table>
				</div>
			) : null}
			<IdentitySectionNav current="users" />
		</section>
	);
}
