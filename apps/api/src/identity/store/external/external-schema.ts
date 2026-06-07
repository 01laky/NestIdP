import { type Kysely, sql } from 'kysely';
import type { ExternalDialect } from './external-connection';
import {
	type ExternalIdentityDB,
	T_GROUP,
	T_META,
	T_ROLE,
	T_USER,
	T_USER_GROUP,
	T_USER_ROLE,
} from './external-schema-types';

/** Bump when the external schema changes; add a numbered step in `runExternalMigrations`. */
export const CURRENT_SCHEMA_VERSION = 1;

export type Ownership = 'empty' | 'ours' | 'foreign';

const OUR_TABLES = [T_USER, T_GROUP, T_ROLE, T_USER_GROUP, T_USER_ROLE, T_META];

function tsType(dialect: ExternalDialect) {
	// MySQL TIMESTAMP is limited to 2038; use DATETIME there. Postgres uses TIMESTAMP.
	return dialect === 'mysql' ? sql`datetime` : sql`timestamp`;
}

export async function listTableNames(db: Kysely<ExternalIdentityDB>): Promise<Set<string>> {
	const tables = await db.introspection.getTables();
	return new Set(tables.map((t) => t.name));
}

export async function getMetaValue(
	db: Kysely<ExternalIdentityDB>,
	key: string,
): Promise<string | null> {
	const row = await db.selectFrom(T_META).select('value').where('key', '=', key).executeTakeFirst();
	return row?.value ?? null;
}

export async function setMetaValue(
	db: Kysely<ExternalIdentityDB>,
	key: string,
	value: string,
): Promise<void> {
	await db
		.insertInto(T_META)
		.values({ key, value })
		.onConflict((oc) => oc.column('key').doUpdateSet({ value }))
		.execute();
}

/** Read-only classification of the target database with respect to our prefixed schema. */
export async function classifyOwnership(db: Kysely<ExternalIdentityDB>): Promise<Ownership> {
	const names = await listTableNames(db);
	const hasMeta = names.has(T_META);
	const hasAnyOurs = OUR_TABLES.some((t) => names.has(t));
	if (hasMeta) {
		const marker = await getMetaValue(db, 'instance_id').catch(() => null);
		return marker ? 'ours' : 'foreign';
	}
	return hasAnyOurs ? 'foreign' : 'empty';
}

/** Create the v1 schema (idempotent). */
export async function createSchemaV1(
	db: Kysely<ExternalIdentityDB>,
	dialect: ExternalDialect,
): Promise<void> {
	const ts = tsType(dialect);

	await db.schema
		.createTable(T_META)
		.ifNotExists()
		.addColumn('key', 'varchar(255)', (c) => c.primaryKey())
		.addColumn('value', sql`text`, (c) => c.notNull())
		.execute();

	await db.schema
		.createTable(T_USER)
		.ifNotExists()
		.addColumn('id', 'varchar(255)', (c) => c.primaryKey())
		.addColumn('external_id', 'varchar(255)', (c) => c.notNull())
		.addColumn('api_connection_id', 'varchar(255)', (c) => c.notNull())
		.addColumn('origin', 'varchar(32)', (c) => c.notNull())
		.addColumn('username', 'varchar(255)', (c) => c.notNull().unique())
		.addColumn('email', 'varchar(320)')
		.addColumn('display_name', 'varchar(255)')
		.addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
		.addColumn('password_hash_algorithm', 'varchar(64)', (c) => c.notNull())
		.addColumn('active', 'boolean', (c) => c.notNull())
		.addColumn('created_at', ts, (c) => c.notNull())
		.addColumn('updated_at', ts, (c) => c.notNull())
		.addUniqueConstraint('nestidp_user_conn_ext', ['api_connection_id', 'external_id'])
		.execute();

	for (const table of [T_GROUP, T_ROLE]) {
		await db.schema
			.createTable(table)
			.ifNotExists()
			.addColumn('id', 'varchar(255)', (c) => c.primaryKey())
			.addColumn('external_id', 'varchar(255)', (c) => c.notNull())
			.addColumn('api_connection_id', 'varchar(255)', (c) => c.notNull())
			.addColumn('origin', 'varchar(32)', (c) => c.notNull())
			.addColumn('name', 'varchar(255)', (c) => c.notNull())
			.addColumn('created_at', ts, (c) => c.notNull())
			.addColumn('updated_at', ts, (c) => c.notNull())
			.addUniqueConstraint(`${table}_conn_ext`, ['api_connection_id', 'external_id'])
			.addUniqueConstraint(`${table}_conn_name`, ['api_connection_id', 'name'])
			.execute();
	}

	await db.schema
		.createTable(T_USER_GROUP)
		.ifNotExists()
		.addColumn('user_id', 'varchar(255)', (c) => c.notNull())
		.addColumn('group_id', 'varchar(255)', (c) => c.notNull())
		.addPrimaryKeyConstraint('nestidp_user_group_pk', ['user_id', 'group_id'])
		.addForeignKeyConstraint('nestidp_ug_user_fk', ['user_id'], T_USER, ['id'], (fk) =>
			fk.onDelete('cascade'),
		)
		.addForeignKeyConstraint('nestidp_ug_group_fk', ['group_id'], T_GROUP, ['id'], (fk) =>
			fk.onDelete('cascade'),
		)
		.execute();

	await db.schema
		.createTable(T_USER_ROLE)
		.ifNotExists()
		.addColumn('user_id', 'varchar(255)', (c) => c.notNull())
		.addColumn('role_id', 'varchar(255)', (c) => c.notNull())
		.addPrimaryKeyConstraint('nestidp_user_role_pk', ['user_id', 'role_id'])
		.addForeignKeyConstraint('nestidp_ur_user_fk', ['user_id'], T_USER, ['id'], (fk) =>
			fk.onDelete('cascade'),
		)
		.addForeignKeyConstraint('nestidp_ur_role_fk', ['role_id'], T_ROLE, ['id'], (fk) =>
			fk.onDelete('cascade'),
		)
		.execute();
}

/** Apply pending schema migrations up to CURRENT_SCHEMA_VERSION (idempotent). */
export async function runExternalMigrations(
	db: Kysely<ExternalIdentityDB>,
	dialect: ExternalDialect,
): Promise<number> {
	const current = Number((await getMetaValue(db, 'schema_version').catch(() => null)) ?? 0);
	if (current < 1) {
		await createSchemaV1(db, dialect);
		await setMetaValue(db, 'schema_version', '1');
	}
	// Future: if (current < 2) { ...alter...; setMetaValue(db,'schema_version','2'); }
	return CURRENT_SCHEMA_VERSION;
}

/**
 * Prepare the target DB for use: classify ownership, create our schema when empty, upgrade when ours,
 * and reject a database whose prefixed tables are not ours. Stamps the instance marker on first use.
 */
export async function ensureSchema(
	db: Kysely<ExternalIdentityDB>,
	dialect: ExternalDialect,
	instanceId: string,
): Promise<{ ownership: Ownership; schemaVersion: number }> {
	const ownership = await classifyOwnership(db);
	if (ownership === 'foreign') {
		return { ownership, schemaVersion: 0 };
	}
	const schemaVersion = await runExternalMigrations(db, dialect);
	if (!(await getMetaValue(db, 'instance_id'))) {
		await setMetaValue(db, 'instance_id', instanceId);
		await setMetaValue(db, 'created_at', new Date().toISOString());
	}
	return { ownership, schemaVersion };
}
