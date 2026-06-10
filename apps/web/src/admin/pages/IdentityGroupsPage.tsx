import { Link } from 'react-router-dom';
import type { IdentityGroupListItemDto } from '@nestidp/shared';
import { IDENTITY_GROUP_NEW_ROUTE, identityGroupDetailRoute } from '@nestidp/shared';
import { listIdentityGroups } from '../adminApi';
import { IdentityListPage, type IdentityListConfig } from '../components/identity/IdentityListPage';
import { createLazyIdentityListTable } from '../components/identity/identityListTableLazy';
import { Badge } from '../../ui';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';

const groupsListConfig: IdentityListConfig<IdentityGroupListItemDto> = {
	navCurrent: 'groups',
	titleKey: 'groupsTitle',
	navLabelKey: 'groups',
	createRoute: IDENTITY_GROUP_NEW_ROUTE,
	createLabelKey: 'createManualGroup',
	emptyTitleKey: 'noGroups',
	emptyDescKey: 'noGroupsDescription',
	filterAriaKey: 'filterGroups',
	loadFailed: 'identity.loadGroupsFailed',
	listTable: createLazyIdentityListTable<IdentityGroupListItemDto>(),
	fetch: ({ offset, limit, filters }) =>
		listIdentityGroups({
			offset,
			limit,
			origin: filters.origin,
			apiConnectionId: filters.source,
		}),
	buildColumns: ({ t, tCommon, sourceLabel }) => [
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
};

export function IdentityGroupsPage() {
	return <IdentityListPage config={groupsListConfig} />;
}
