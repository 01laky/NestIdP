import { FormEvent, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import type { IdentityGroupListItemDto } from '@nestidp/shared';
import { IDENTITY_GROUP_NEW_ROUTE, identityGroupDetailRoute } from '@nestidp/shared';
import { AdminApiError, listIdentityGroups } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { createLazyIdentityListTable } from '../components/identityListTableLazy';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useIdentityListQuery } from '../hooks/useIdentityListQuery';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../i18n/enum-labels';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Select } from '../../ui';

const IdentityListTable = createLazyIdentityListTable<IdentityGroupListItemDto>();

export function IdentityGroupsPage() {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('groupsTitle'));
	const [origin, setOrigin] = useState('');

	const mapError = useCallback(
		(err: unknown) =>
			err instanceof AdminApiError
				? formatAdminApiError(
						err.statusCode,
						err.message,
						resolveI18nKey,
						'identity.loadGroupsFailed',
					)
				: t('loadGroupsFailed'),
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
			const data = await listIdentityGroups({
				offset,
				limit,
				origin: filters.origin,
			});
			return { items: data.items, total: data.total };
		},
		[],
	);

	const { pageIndex, total, items, error, initialLoading, refetching, applyFilters, goToPage } =
		useIdentityListQuery<IdentityGroupListItemDto>({
			fetchPage,
			initialFilters: { origin: undefined },
			mapError,
		});

	const columns = useMemo<ColumnDef<IdentityGroupListItemDto, unknown>[]>(
		() => [
			{
				id: 'name',
				header: () => tCommon('name'),
				cell: ({ row }) => (
					<Link to={identityGroupDetailRoute(row.original.id)}>{row.original.name}</Link>
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
				id: 'members',
				header: () => tCommon('members'),
				cell: ({ row }) => row.original.memberCount ?? tCommon('emDash'),
			},
		],
		[tCommon],
	);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		applyFilters({ origin: origin || undefined });
	}

	const filterDisabled = refetching;
	const showEmpty = !initialLoading && !error && total === 0;
	const showTable = !initialLoading && total > 0;

	return (
		<section>
			<AdminPageHeader
				title={t('groupsTitle')}
				subtitle={tCommon('total', { count: total })}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tCommon('identity') },
					{ label: tNav('groups') },
				]}
				actions={
					<ButtonLink to={IDENTITY_GROUP_NEW_ROUTE} variant="primary">
						{t('createManualGroup')}
					</ButtonLink>
				}
			/>
			<form
				className="evg-inline-form"
				aria-label={t('filterGroups')}
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
				<Button type="submit" variant="secondary" disabled={filterDisabled}>
					{tCommon('apply')}
				</Button>
			</form>
			{initialLoading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{showEmpty ? (
				<EmptyState
					title={t('noGroups')}
					description={t('noGroupsDescription')}
					action={
						<ButtonLink to={IDENTITY_GROUP_NEW_ROUTE} variant="primary">
							{t('createManualGroup')}
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
			<IdentitySectionNav current="groups" />
		</section>
	);
}
