#!/usr/bin/env node
/**
 * Maintenance CLI for the encrypted libSQL database. Run with the app stopped.
 *
 *   node scripts/db-cli.mjs migrate                 # apply pending migrations (db:migrate:deploy)
 *   node scripts/db-cli.mjs rekey --new <newKey>    # re-encrypt with a new key (PRAGMA rekey)
 *   node scripts/db-cli.mjs backup <out.db>         # consistent encrypted copy (VACUUM INTO)
 *   node scripts/db-cli.mjs dump <out.sql>          # plaintext SQL dump (PLAINTEXT — handle with care)
 *   node scripts/db-cli.mjs restore <in.sql>        # load a SQL dump into DATABASE_URL
 *
 * Reads DATABASE_URL + DATABASE_ENCRYPTION_KEY[_FILE] from the environment.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function requireUrl() {
	const url = (process.env.DATABASE_URL ?? '').trim();
	if (!url.startsWith('file:')) throw new Error('DATABASE_URL must use the file: scheme');
	return url;
}
function resolveKey() {
	const inline = process.env.DATABASE_ENCRYPTION_KEY?.trim();
	const file = process.env.DATABASE_ENCRYPTION_KEY_FILE?.trim();
	if (inline && file) throw new Error('Set only one of DATABASE_ENCRYPTION_KEY / _FILE');
	if (inline) return inline;
	if (file) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
	return undefined;
}
function open(url, encryptionKey) {
	return createClient(encryptionKey ? { url, encryptionKey } : { url });
}
function splitStatements(sql) {
	return sql
		.split('\n')
		.filter((l) => !l.trim().startsWith('--'))
		.join('\n')
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
}
function flag(name) {
	const i = process.argv.indexOf(name);
	return i !== -1 ? process.argv[i + 1] : undefined;
}

async function migrate() {
	const client = open(requireUrl(), resolveKey());
	const dir = join(apiRoot, 'prisma/migrations');
	const T = '__app_migrations';
	await client.execute(`CREATE TABLE IF NOT EXISTS "${T}" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
	const applied = new Set((await client.execute(`SELECT name FROM "${T}"`)).rows.map((r) => String(r.name)));
	const migrations = readdirSync(dir)
		.filter((n) => statSync(join(dir, n)).isDirectory())
		.sort()
		.map((name) => ({ name, sql: readFileSync(join(dir, name, 'migration.sql'), 'utf8') }));
	let n = 0;
	for (const m of migrations) {
		if (applied.has(m.name)) continue;
		for (const s of splitStatements(m.sql)) await client.execute(s);
		await client.execute({
			sql: `INSERT INTO "${T}" (name, checksum, applied_at) VALUES (?, ?, ?)`,
			args: [m.name, createHash('sha256').update(m.sql).digest('hex'), new Date().toISOString()],
		});
		n += 1;
	}
	client.close();
	console.log(`Applied ${n} migration(s).`);
}

async function rekey() {
	const newKey = flag('--new') ?? process.env.DATABASE_ENCRYPTION_KEY_NEW;
	if (!newKey) throw new Error('rekey requires --new <newKey> (or DATABASE_ENCRYPTION_KEY_NEW)');
	const client = open(requireUrl(), resolveKey());
	await client.execute(`PRAGMA rekey='${newKey.replace(/'/g, "''")}'`);
	client.close();
	console.log('Database re-encrypted with the new key.');
}

async function backup() {
	const out = process.argv[3];
	if (!out) throw new Error('backup requires an output path');
	const client = open(requireUrl(), resolveKey());
	await client.execute(`VACUUM INTO 'file:${resolve(out)}'`);
	client.close();
	console.log(`Encrypted backup written to ${resolve(out)} (same key).`);
}

async function dump() {
	const out = process.argv[3];
	if (!out) throw new Error('dump requires an output .sql path');
	const client = open(requireUrl(), resolveKey());
	const tables = (
		await client.execute(
			"SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
	).rows;
	let outSql = 'PRAGMA foreign_keys=OFF;\n';
	for (const t of tables) {
		outSql += `${t.sql};\n`;
		const rows = (await client.execute(`SELECT * FROM "${t.name}"`)).rows;
		for (const row of rows) {
			const cols = Object.keys(row);
			const vals = cols.map((c) => {
				const v = row[c];
				if (v === null || v === undefined) return 'NULL';
				if (typeof v === 'number') return String(v);
				return `'${String(v).replace(/'/g, "''")}'`;
			});
			outSql += `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
		}
	}
	client.close();
	writeFileSync(resolve(out), outSql);
	console.log(`PLAINTEXT dump written to ${resolve(out)} — store securely and delete when done.`);
}

async function restore() {
	const inPath = process.argv[3];
	if (!inPath || !existsSync(inPath)) throw new Error('restore requires an existing .sql path');
	const client = open(requireUrl(), resolveKey());
	for (const s of splitStatements(readFileSync(inPath, 'utf8'))) {
		await client.execute(s);
	}
	client.close();
	console.log('Restore complete.');
}

const cmd = process.argv[2];
const commands = { migrate, rekey, backup, dump, restore };
const fn = commands[cmd];
if (!fn) {
	console.error(`Unknown command "${cmd}". Use: ${Object.keys(commands).join(', ')}`);
	process.exit(1);
}
fn().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
