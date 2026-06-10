import { IDENTITY_ROUTE_PREFIX, identityGroupEditRoute } from '@nestidp/shared';
import { deleteIdentityGroup, getIdentityGroup } from '../adminApi';
import {
	IdentityMemberDetailPage,
	type IdentityMemberDetailConfig,
} from '../components/identity/IdentityMemberDetailPage';

const groupDetailConfig: IdentityMemberDetailConfig = {
	load: async (id) => {
		const data = await getIdentityGroup(id);
		return { entity: data.group, members: data.members, memberCount: data.memberCount };
	},
	remove: (id) => deleteIdentityGroup(id),
	editRoute: identityGroupEditRoute,
	listPath: `${IDENTITY_ROUTE_PREFIX}/groups`,
	keys: {
		docTitle: 'viewGroup',
		loadFailed: 'identity.loadGroupFailed',
		notFound: 'groupNotFound',
		navList: 'groups',
		syncedCallout: 'syncedGroupCallout',
		backTo: 'backToGroups',
		confirmDeleteTitle: 'confirmDeleteGroupTitle',
		confirmDelete: 'confirmDeleteGroup',
		confirmDeleteWithMembers: 'confirmDeleteGroupWithMembers',
		toastDeleted: 'toastGroupDeleted',
	},
};

export function IdentityGroupDetailPage() {
	return <IdentityMemberDetailPage config={groupDetailConfig} />;
}
