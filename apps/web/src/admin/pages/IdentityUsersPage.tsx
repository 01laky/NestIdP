import { FormEvent, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import type { IdentityUserListItemDto } from '@nestidp/shared';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, listIdentityUsers } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { IdentitySectionNav } from '../components/identity/IdentitySectionNav';
import { createLazyIdentityListTable } from '../components/identity/identityListTableLazy';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useIdentityListQuery } from '../hooks/useIdentityListQuery';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../i18n/enum-labels';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Panel, Select, TextInput } from '../../ui';

const IdentityListTable = createLazyIdentityListTable<IdentityUserListItemDto>();

export function IdentityUsersPage() {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('usersTitle'));
	const [search, setSearch] = useState('');
	const [origin, setOrigin] = useState('');

	const mapError = useCallback(
		(err: unknown) =>
			err instanceof AdminApiError
				? formatAdminApiError(
						err.statusCode,
						err.message,
						resolveI18nKey,
						'identity.loadUsersFailed',
					)
				: t('loadUsersFailed'),
		[t],
	);

	const fetchPage = useCallback(
		async ({
			offset,
			limit,
			filters,
		}: {
			offset: number;
			limit: number;
			filters: Record<string, string | undefined>;
		}) => {
			const data = await listIdentityUsers({
				offset,
				limit,
				search: filters.search,
				origin: filters.origin,
			});
			return { items: data.items, total: data.total };
		},
		[],
	);

	const { pageIndex, total, items, error, initialLoading, refetching, applyFilters, goToPage } =
		useIdentityListQuery<IdentityUserListItemDto>({
			fetchPage,
			initialFilters: { search: undefined, origin: undefined },
			mapError,
		});

	const columns = useMemo<ColumnDef<IdentityUserListItemDto, unknown>[]>(
		() => [
			{
				id: 'username',
				header: () => tCommon('username'),
				cell: ({ row }) => (
					<Link to={identityUserDetailRoute(row.original.id)}>{row.original.username}</Link>
				),
			},
			{
				id: 'email',
				header: () => tCommon('email'),
				cell: ({ row }) => row.original.email ?? tCommon('emDash'),
			},
			{
				id: 'origin',
				header: () => tCommon('origin'),
				cell: ({ row }) => (
					<Badge variant={identityOriginToBadge(row.original.origin)}>
						{identityOriginLabel(row.original.origin)}
					</Badge>
				),
			},
			{
				id: 'active',
				header: () => t('tableActive'),
				cell: ({ row }) => (row.original.active ? tCommon('yes') : tCommon('no')),
			},
		],
		[t, tCommon],
	);

	function handleSearch(event: FormEvent) {
		event.preventDefault();
		applyFilters({
			search: search || undefined,
			origin: origin || undefined,
		});
	}

	const filterDisabled = refetching;
	const showEmpty = !initialLoading && !error && total === 0;
	const showTable = !initialLoading && total > 0;

	return (
		<section>
			<AdminPageHeader
				title={t('usersTitle')}
				subtitle={tCommon('total', { count: total })}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tCommon('identity'), to: '/admin/identity/users' },
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
				aria-busy={refetching}
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
			{initialLoading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{showEmpty ? (
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
			{showTable ? (
				<Suspense fallback={null}>
					<IdentityListTable
						columns={columns}
						data={items}
						total={total}
						pageIndex={pageIndex}
						onPageChange={goToPage}
						loading={refetching}
					/>
				</Suspense>
			) : null}
			<IdentitySectionNav current="users" />
		</section>
	);
}
