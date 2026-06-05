import type { SpAttributeMappingConfig } from '@nestidp/shared';

export const SP_ATTRIBUTE_MAPPING_PRESETS: Array<{
	id: string;
	mapping: SpAttributeMappingConfig;
}> = [
	{
		id: 'email-nameid',
		mapping: {
			nameId: { source: 'email' },
			attributes: [{ samlName: 'displayName', source: 'displayName' }],
		},
	},
	{
		id: 'username-groups',
		mapping: {
			nameId: { source: 'username' },
			attributes: [
				{ samlName: 'groups', source: 'groups' },
				{ samlName: 'roles', source: 'roles' },
			],
		},
	},
];
