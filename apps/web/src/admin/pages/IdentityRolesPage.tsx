import { FormEvent, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import type { IdentityRoleListItemDto } from '@nestidp/shared';
import { IDENTITY_ROLE_NEW_ROUTE, identityRoleDetailRoute } from '@nestidp/shared';
import { AdminApiError, listIdentityRoles } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { IdentitySectionNav } from '../components/identity/IdentitySectionNav';
import { SourceFilterSelect } from '../components/identity/SourceFilterSelect';
import { useIdentitySources } from '../hooks/useIdentitySources';
import { createLazyIdentityListTable } from '../components/identity/identityListTableLazy';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useIdentityListQuery } from '../hooks/useIdentityListQuery';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../i18n/enum-labels';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Select } from '../../ui';

const IdentityListTable = createLazyIdentityListTable<IdentityRoleListItemDto>();

export function IdentityRolesPage() {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('rolesTitle'));
	const [origin, setOrigin] = useState('');
	const [source, setSource] = useState('');
	const { sources, sourceLabel } = useIdentitySources();

	const mapError = useCallback(
		(err: unknown) =>
			err instanceof AdminApiError
				? formatAdminApiError(
						err.statusCode,
						err.message,
						resolveI18nKey,
						'identity.loadRolesFailed',
					)
				: t('loadRolesFailed'),
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
			const data = await listIdentityRoles({
				offset,
				limit,
				origin: filters.origin,
				apiConnectionId: filters.source,
			});
			return { items: data.items, total: data.total };
		},
		[],
	);

	const { pageIndex, total, items, error, initialLoading, refetching, applyFilters, goToPage } =
		useIdentityListQuery<IdentityRoleListItemDto>({
			fetchPage,
			initialFilters: { origin: undefined, source: undefined },
			mapError,
		});

	const columns = useMemo<ColumnDef<IdentityRoleListItemDto, unknown>[]>(
		() => [
			{
				id: 'name',
				header: () => tCommon('name'),
				cell: ({ row }) => (
					<Link to={identityRoleDetailRoute(row.original.id)}>{row.original.name}</Link>
				),
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
				id: 'source',
				header: () => t('colSource'),
				cell: ({ row }) => (
					<span className="evg-muted">{sourceLabel(row.original.apiConnectionId)}</span>
				),
			},
			{
				id: 'members',
				header: () => tCommon('members'),
				cell: ({ row }) => row.original.memberCount ?? tCommon('emDash'),
			},
		],
		[t, tCommon, sourceLabel],
	);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		applyFilters({ origin: origin || undefined, source: source || undefined });
	}

	const filterDisabled = refetching;
	const showEmpty = !initialLoading && !error && total === 0;
	const showTable = !initialLoading && total > 0;

	return (
		<section>
			<AdminPageHeader
				title={t('rolesTitle')}
				subtitle={tCommon('total', { count: total })}
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
				aria-busy={refetching}
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
				<SourceFilterSelect
					sources={sources}
					value={source}
					onChange={setSource}
					disabled={filterDisabled}
				/>
				<Button type="submit" variant="secondary" disabled={filterDisabled}>
					{tCommon('apply')}
				</Button>
			</form>
			{initialLoading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{showEmpty ? (
				<EmptyState
					title={t('noRoles')}
					description={t('noRolesDescription')}
					action={
						<ButtonLink to={IDENTITY_ROLE_NEW_ROUTE} variant="primary">
							{t('createManualRole')}
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
			<IdentitySectionNav current="roles" />
		</section>
	);
}
