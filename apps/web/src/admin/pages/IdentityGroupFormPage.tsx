import { IDENTITY_ROUTE_PREFIX, identityGroupDetailRoute } from '@nestidp/shared';
import { createIdentityGroup, getIdentityGroup, updateIdentityGroup } from '../adminApi';
import {
	SimpleNameFormPage,
	type SimpleNameFormConfig,
} from '../components/identity/SimpleNameFormPage';

const groupFormConfig: SimpleNameFormConfig = {
	load: async (id) => {
		const data = await getIdentityGroup(id);
		return { name: data.group.name, isManual: data.group.origin === 'manual' };
	},
	create: async (name) => {
		const created = await createIdentityGroup({ name });
		return identityGroupDetailRoute(created.group.id);
	},
	update: async (id, name) => {
		const updated = await updateIdentityGroup(id, { name });
		return identityGroupDetailRoute(updated.group.id);
	},
	detailRoute: identityGroupDetailRoute,
	listPath: `${IDENTITY_ROUTE_PREFIX}/groups`,
	keys: {
		docTitleNew: 'formNewGroup',
		docTitleEdit: 'formEditGroup',
		loadFailed: 'identity.loadGroupFailed',
		navList: 'groups',
		managedBySync: 'managedBySyncGroup',
		view: 'viewGroup',
		panel: 'groupPanel',
		create: 'createGroup',
		toastCreated: 'toastGroupCreated',
		toastSaved: 'toastGroupSaved',
	},
};

export function IdentityGroupFormPage() {
	return <SimpleNameFormPage config={groupFormConfig} />;
}
