import { Link } from 'react-router-dom';
import type { IdentityUserListItemDto } from '@nestidp/shared';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { listIdentityUsers } from '../adminApi';
import { IdentityListPage, type IdentityListConfig } from '../components/identity/IdentityListPage';
import { createLazyIdentityListTable } from '../components/identity/identityListTableLazy';
import { Badge, Panel } from '../../ui';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';

const usersListConfig: IdentityListConfig<IdentityUserListItemDto> = {
	navCurrent: 'users',
	titleKey: 'usersTitle',
	navLabelKey: 'users',
	identityCrumbTo: '/admin/identity/users',
	createRoute: IDENTITY_USER_NEW_ROUTE,
	createLabelKey: 'createManualUser',
	emptyTitleKey: 'noUsers',
	emptyDescKey: 'noUsersDescription',
	filterAriaKey: 'filterUsers',
	loadFailed: 'identity.loadUsersFailed',
	search: { placeholderKey: 'searchPlaceholder' },
	renderCallout: ({ t, tNav }) => (
		<Panel title={t('calloutTitle')} className="evg-identity-callout">
			<p>{t('calloutBody')}</p>
			<p>
				<Link to={API_CONNECTION_ROUTE_PREFIX}>{tNav('apiConnections')}</Link>
				{' · '}
				<Link to={IDENTITY_USER_NEW_ROUTE}>{t('createManualUser')}</Link>
			</p>
		</Panel>
	),
	listTable: createLazyIdentityListTable<IdentityUserListItemDto>(),
	fetch: ({ offset, limit, filters }) =>
		listIdentityUsers({
			offset,
			limit,
			search: filters.search,
			origin: filters.origin,
			apiConnectionId: filters.source,
		}),
	buildColumns: ({ t, tCommon, sourceLabel }) => [
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
			id: 'source',
			header: () => t('colSource'),
			cell: ({ row }) => (
				<span className="evg-muted">{sourceLabel(row.original.apiConnectionId)}</span>
			),
		},
		{
			id: 'active',
			header: () => t('tableActive'),
			cell: ({ row }) => (row.original.active ? tCommon('yes') : tCommon('no')),
		},
	],
};

export function IdentityUsersPage() {
	return <IdentityListPage config={usersListConfig} />;
}
