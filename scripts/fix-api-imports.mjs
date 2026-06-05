#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'apps/api/src');

function walk(dir) {
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walk(p));
		else if (p.endsWith('.ts')) out.push(p);
	}
	return out;
}

function buildModuleMaps() {
	const maps = new Map();
	for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue;
		const modDir = path.join(srcRoot, ent.name);
		const fileMap = new Map();
		for (const sub of [
			'controllers',
			'services',
			'dto',
			'utils',
			'validators',
			'guards',
			'pipes',
			'mappers',
		]) {
			const subPath = path.join(modDir, sub);
			if (!fs.existsSync(subPath)) continue;
			for (const f of fs.readdirSync(subPath)) {
				if (f.endsWith('.ts')) {
					fileMap.set(f.replace(/\.ts$/, ''), sub);
				}
			}
		}
		// root-level ts (e.g. http-security before move)
		for (const f of fs.readdirSync(modDir)) {
			if (f.endsWith('.ts') && !f.endsWith('.module.ts')) {
				const full = path.join(modDir, f);
				if (fs.statSync(full).isFile()) fileMap.set(f.replace(/\.ts$/, ''), '.');
			}
		}
		maps.set(ent.name, fileMap);
	}
	// common/utils/http-security
	const commonUtils = path.join(srcRoot, 'common', 'utils');
	if (fs.existsSync(commonUtils)) {
		const m = maps.get('common') ?? new Map();
		for (const f of fs.readdirSync(commonUtils)) {
			if (f.endsWith('.ts')) m.set(f.replace(/\.ts$/, ''), 'utils');
		}
		maps.set('common', m);
	}
	return maps;
}

function moduleOf(filePath) {
	const rel = path.relative(srcRoot, filePath);
	return rel.split(path.sep)[0];
}

function subfolderOf(filePath) {
	const rel = path.relative(srcRoot, filePath);
	const parts = rel.split(path.sep);
	return parts.length > 2 ? parts[1] : '.';
}

function fixSpec(importerPath, spec, maps) {
	if (!spec.startsWith('.')) return spec;
	const parts = spec.split('/');
	const last = parts[parts.length - 1];
	const base = last.replace(/\.ts$/, '');

	// ../module/file
	if (parts.length === 3 && parts[0] === '..' && !parts[2].includes('/')) {
		const mod = parts[1];
		const folder = maps.get(mod)?.get(base);
		if (folder && folder !== '.') {
			return `../${mod}/${folder}/${last}`;
		}
	}

	// ./file (same module, wrong subfolder)
	if (parts.length === 2 && parts[0] === '.') {
		const mod = moduleOf(importerPath);
		const folder = maps.get(mod)?.get(base);
		const importerSub = subfolderOf(importerPath);
		if (folder && folder !== '.' && folder !== importerSub) {
			return `../${folder}/${last}`;
		}
	}

	// ../file (parent of subfolder — e.g. services importing ../dto/x)
	if (parts.length === 2 && parts[0] === '..') {
		const mod = moduleOf(importerPath);
		const folder = maps.get(mod)?.get(base);
		if (folder && folder !== '.') {
			return `../${folder}/${last}`;
		}
	}

	return spec;
}

const maps = buildModuleMaps();
for (const file of walk(srcRoot)) {
	let content = fs.readFileSync(file, 'utf8');
	const next = content.replace(/from ['"](\.[^'"]+)['"]/g, (_, spec) => {
		const fixed = fixSpec(file, spec, maps);
		return `from '${fixed}'`;
	});
	if (next !== content) fs.writeFileSync(file, next);
}

// Fix test files @api paths
const testRoot = path.join(repoRoot, 'apps/api/test');
for (const file of walk(testRoot)) {
	if (!file.endsWith('.spec.ts')) continue;
	let content = fs.readFileSync(file, 'utf8');
	for (const [mod, fileMap] of maps) {
		for (const [base, folder] of fileMap) {
			if (folder === '.') continue;
			content = content.replaceAll(`@api/${mod}/${base}`, `@api/${mod}/${folder}/${base}`);
		}
	}
	fs.writeFileSync(file, content);
}

console.log('API imports updated.');
