import { Link } from 'react-router-dom';
import type { IdentityRoleListItemDto } from '@nestidp/shared';
import { IDENTITY_ROLE_NEW_ROUTE, identityRoleDetailRoute } from '@nestidp/shared';
import { listIdentityRoles } from '../adminApi';
import { IdentityListPage, type IdentityListConfig } from '../components/identity/IdentityListPage';
import { createLazyIdentityListTable } from '../components/identity/identityListTableLazy';
import { Badge } from '../../ui';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';

const rolesListConfig: IdentityListConfig<IdentityRoleListItemDto> = {
	navCurrent: 'roles',
	titleKey: 'rolesTitle',
	navLabelKey: 'roles',
	createRoute: IDENTITY_ROLE_NEW_ROUTE,
	createLabelKey: 'createManualRole',
	emptyTitleKey: 'noRoles',
	emptyDescKey: 'noRolesDescription',
	filterAriaKey: 'filterRoles',
	loadFailed: 'identity.loadRolesFailed',
	listTable: createLazyIdentityListTable<IdentityRoleListItemDto>(),
	fetch: ({ offset, limit, filters }) =>
		listIdentityRoles({
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
};

export function IdentityRolesPage() {
	return <IdentityListPage config={rolesListConfig} />;
}
