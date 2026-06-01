import type { SpAttributeMappingConfig } from '@nestidp/shared';

export const SP_ATTRIBUTE_MAPPING_PRESETS: Array<{
	id: string;
	label: string;
	mapping: SpAttributeMappingConfig;
}> = [
	{
		id: 'email-nameid',
		label: 'Email NameID + display name',
		mapping: {
			nameId: { source: 'email' },
			attributes: [{ samlName: 'displayName', source: 'displayName' }],
		},
	},
	{
		id: 'username-groups',
		label: 'Username NameID + groups',
		mapping: {
			nameId: { source: 'username' },
			attributes: [
				{ samlName: 'groups', source: 'groups' },
				{ samlName: 'roles', source: 'roles' },
			],
		},
	},
];
