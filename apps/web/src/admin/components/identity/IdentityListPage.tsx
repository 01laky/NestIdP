import { type FormEvent, type ReactNode, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { AdminPageHeader } from '../layout/AdminPageHeader';
import { IdentitySectionNav } from './IdentitySectionNav';
import { SourceFilterSelect } from './SourceFilterSelect';
import { useIdentitySources } from '../../hooks/useIdentitySources';
import type { createLazyIdentityListTable } from './identityListTableLazy';
import { EmptyState } from '../common/EmptyState';
import { ErrorBanner } from '../common/ErrorBanner';
import { LoadingState } from '../common/LoadingState';
import { useIdentityListQuery } from '../../hooks/useIdentityListQuery';
import { useAdminDocumentTitle } from '../../../i18n/useAdminDocumentTitle';
import { mapAdminError, resolveI18nKey } from '../../../i18n/api-error-messages';
import { identityOriginFilterLabel } from '../../../i18n/enum-labels';
import { Button, ButtonLink, Select, TextInput } from '../../../ui';

type ListFilters = Record<string, string | undefined>;
type TFn = ReturnType<typeof useTranslation>['t'];
type ColumnCtx = {
	t: TFn;
	tCommon: TFn;
	sourceLabel: (apiConnectionId: string) => string;
};
type CalloutCtx = { t: TFn; tNav: TFn; tCommon: TFn };

/**
 * Per-kind configuration for {@link IdentityListPage} (Prompt 38 §A17 / §6.9). The user / group / role
 * list pages were ~95% identical — same query hook, source filter, empty state, lazy table and section nav,
 * differing only by the entity columns, the create route/labels, and (users only) a free-text search field
 * and an info callout. Each kind supplies those here. `loadFailed` is fully-qualified for
 * {@link mapAdminError}; the other `*Key` fields resolve in the `identity` namespace, `navLabelKey` in `nav`.
 */
export interface IdentityListConfig<T extends { id: string }> {
	navCurrent: 'users' | 'groups' | 'roles';
	titleKey: string;
	navLabelKey: string;
	identityCrumbTo?: string;
	createRoute: string;
	createLabelKey: string;
	emptyTitleKey: string;
	emptyDescKey: string;
	filterAriaKey: string;
	loadFailed: string;
	/** When set, the toolbar renders a free-text search input (users list). */
	search?: { placeholderKey: string };
	/** Optional content rendered above the toolbar (users list info callout). */
	renderCallout?: (ctx: CalloutCtx) => ReactNode;
	/** Lazy table component created once per kind via `createLazyIdentityListTable<T>()`. */
	listTable: ReturnType<typeof createLazyIdentityListTable<T>>;
	fetch(args: { offset: number; limit: number; filters: ListFilters }): Promise<{
		items: T[];
		total: number;
	}>;
	buildColumns(ctx: ColumnCtx): ColumnDef<T, unknown>[];
}

/** Config-driven list page for a synced/manual identity collection (users, groups or roles). */
export function IdentityListPage<T extends { id: string }>({
	config,
}: {
	config: IdentityListConfig<T>;
}) {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t(config.titleKey));
	const [search, setSearch] = useState('');
	const [origin, setOrigin] = useState('');
	const [source, setSource] = useState('');
	const { sources, sourceLabel } = useIdentitySources();
	const ListTable = config.listTable;

	const mapError = useCallback((err: unknown) => mapAdminError(err, config.loadFailed), [config]);
	const fetchPage = useCallback(
		(args: { offset: number; limit: number; filters: ListFilters }) => config.fetch(args),
		[config],
	);

	const initialFilters: ListFilters = {
		origin: undefined,
		source: undefined,
		...(config.search ? { search: undefined } : {}),
	};

	const { pageIndex, total, items, error, initialLoading, refetching, applyFilters, goToPage } =
		useIdentityListQuery<T>({ fetchPage, initialFilters, mapError });

	const columns = useMemo(
		() => config.buildColumns({ t, tCommon, sourceLabel }),
		[config, t, tCommon, sourceLabel],
	);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		applyFilters({
			origin: origin || undefined,
			source: source || undefined,
			...(config.search ? { search: search || undefined } : {}),
		});
	}

	const filterDisabled = refetching;
	const showEmpty = !initialLoading && !error && total === 0;
	const showTable = !initialLoading && total > 0;

	return (
		<section>
			<AdminPageHeader
				title={t(config.titleKey)}
				subtitle={tCommon('total', { count: total })}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tCommon('identity'), to: config.identityCrumbTo },
					{ label: tNav(config.navLabelKey) },
				]}
				actions={
					<ButtonLink to={config.createRoute} variant="primary">
						{t(config.createLabelKey)}
					</ButtonLink>
				}
			/>
			{config.renderCallout?.({ t, tNav, tCommon })}
			<form
				className="evg-inline-form"
				role={config.search ? 'search' : undefined}
				aria-label={t(config.filterAriaKey)}
				aria-busy={refetching}
				onSubmit={handleFilter}
			>
				{config.search ? (
					<TextInput
						label={tCommon('search')}
						fieldClassName="evg-field--grow"
						placeholder={t(config.search.placeholderKey)}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						disabled={filterDisabled}
					/>
				) : null}
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
					title={t(config.emptyTitleKey)}
					description={t(config.emptyDescKey)}
					action={
						<ButtonLink to={config.createRoute} variant="primary">
							{t(config.createLabelKey)}
						</ButtonLink>
					}
				/>
			) : null}
			{showTable ? (
				<Suspense fallback={null}>
					<ListTable
						columns={columns}
						data={items}
						total={total}
						pageIndex={pageIndex}
						onPageChange={goToPage}
						loading={refetching}
					/>
				</Suspense>
			) : null}
			<IdentitySectionNav current={config.navCurrent} />
		</section>
	);
}
