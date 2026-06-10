import { IDENTITY_ROUTE_PREFIX, identityRoleEditRoute } from '@nestidp/shared';
import { deleteIdentityRole, getIdentityRole } from '../adminApi';
import {
	IdentityMemberDetailPage,
	type IdentityMemberDetailConfig,
} from '../components/identity/IdentityMemberDetailPage';

const roleDetailConfig: IdentityMemberDetailConfig = {
	load: async (id) => {
		const data = await getIdentityRole(id);
		return { entity: data.role, members: data.members, memberCount: data.memberCount };
	},
	remove: (id) => deleteIdentityRole(id),
	editRoute: identityRoleEditRoute,
	listPath: `${IDENTITY_ROUTE_PREFIX}/roles`,
	keys: {
		docTitle: 'viewRole',
		loadFailed: 'identity.loadRoleFailed',
		notFound: 'roleNotFound',
		navList: 'roles',
		syncedCallout: 'syncedRoleCallout',
		backTo: 'backToRoles',
		confirmDeleteTitle: 'confirmDeleteRoleTitle',
		confirmDelete: 'confirmDeleteRole',
		confirmDeleteWithMembers: 'confirmDeleteRoleWithMembers',
		toastDeleted: 'toastRoleDeleted',
	},
};

export function IdentityRoleDetailPage() {
	return <IdentityMemberDetailPage config={roleDetailConfig} />;
}
