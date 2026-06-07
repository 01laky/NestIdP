/**
 * Kysely table typings for the external identity database (Prompt 31).
 *
 * NestIdP owns a small set of prefixed tables in the customer's Postgres/MySQL database. The prefix
 * is fixed at `nestidp_` (the schemaPrefix config column is reserved for future use). Columns are
 * snake_case (SQL convention); `SqlIdentityStore` maps them to/from the camelCase domain shapes.
 */

export const NESTIDP_PREFIX = 'nestidp_';
export const T_USER = 'nestidp_user';
export const T_GROUP = 'nestidp_group';
export const T_ROLE = 'nestidp_role';
export const T_USER_GROUP = 'nestidp_user_group';
export const T_USER_ROLE = 'nestidp_user_role';
export const T_META = 'nestidp_meta';

export interface NestidpUserTable {
	id: string;
	external_id: string;
	api_connection_id: string;
	origin: string;
	username: string;
	email: string | null;
	display_name: string | null;
	password_hash: string;
	password_hash_algorithm: string;
	active: boolean;
	created_at: Date;
	updated_at: Date;
}

export interface NestidpGroupTable {
	id: string;
	external_id: string;
	api_connection_id: string;
	origin: string;
	name: string;
	created_at: Date;
	updated_at: Date;
}

export type NestidpRoleTable = NestidpGroupTable;

export interface NestidpUserGroupTable {
	user_id: string;
	group_id: string;
}

export interface NestidpUserRoleTable {
	user_id: string;
	role_id: string;
}

export interface NestidpMetaTable {
	key: string;
	value: string;
}

export interface ExternalIdentityDB {
	nestidp_user: NestidpUserTable;
	nestidp_group: NestidpGroupTable;
	nestidp_role: NestidpRoleTable;
	nestidp_user_group: NestidpUserGroupTable;
	nestidp_user_role: NestidpUserRoleTable;
	nestidp_meta: NestidpMetaTable;
}
