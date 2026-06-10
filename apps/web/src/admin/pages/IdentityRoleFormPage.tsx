import { IDENTITY_ROUTE_PREFIX, identityRoleDetailRoute } from '@nestidp/shared';
import { createIdentityRole, getIdentityRole, updateIdentityRole } from '../adminApi';
import {
	SimpleNameFormPage,
	type SimpleNameFormConfig,
} from '../components/identity/SimpleNameFormPage';

const roleFormConfig: SimpleNameFormConfig = {
	load: async (id) => {
		const data = await getIdentityRole(id);
		return { name: data.role.name, isManual: data.role.origin === 'manual' };
	},
	create: async (name) => {
		const created = await createIdentityRole({ name });
		return identityRoleDetailRoute(created.role.id);
	},
	update: async (id, name) => {
		const updated = await updateIdentityRole(id, { name });
		return identityRoleDetailRoute(updated.role.id);
	},
	detailRoute: identityRoleDetailRoute,
	listPath: `${IDENTITY_ROUTE_PREFIX}/roles`,
	keys: {
		docTitleNew: 'formNewRole',
		docTitleEdit: 'formEditRole',
		loadFailed: 'identity.loadRoleFailed',
		navList: 'roles',
		managedBySync: 'managedBySyncRole',
		view: 'viewRole',
		panel: 'rolePanel',
		create: 'createRole',
		toastCreated: 'toastRoleCreated',
		toastSaved: 'toastRoleSaved',
	},
};

export function IdentityRoleFormPage() {
	return <SimpleNameFormPage config={roleFormConfig} />;
}
