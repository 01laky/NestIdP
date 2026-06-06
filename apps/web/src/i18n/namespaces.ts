export const I18N_NAMESPACES = [
	'common',
	'nav',
	'adminAuth',
	'login',
	'dashboard',
	'apiConnections',
	'spConnections',
	'samlSessions',
	'loggedOut',
	'idpSettings',
	'identity',
	'audit',
	'adminUsers',
	'sync',
	'errors',
	'enums',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
