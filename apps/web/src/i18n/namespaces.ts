export const I18N_NAMESPACES = [
	'common',
	'nav',
	'adminAuth',
	'login',
	'dashboard',
	'apiConnections',
	'spConnections',
	'idpSettings',
	'identity',
	'audit',
	'adminUsers',
	'sync',
	'errors',
	'enums',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
