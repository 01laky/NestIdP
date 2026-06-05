#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web');
const srcRoot = path.join(webRoot, 'src');
const testRoot = path.join(webRoot, 'test');

function walk(dir) {
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walk(p));
		else if (/\.(tsx?)$/.test(p)) out.push(p);
	}
	return out;
}

function resolveToAlias(fromFile, spec) {
	if (!spec.startsWith('.')) return spec;
	const abs = path.resolve(path.dirname(fromFile), spec);
	const tryExts = ['', '.ts', '.tsx'];
	for (const ext of tryExts) {
		const candidate = abs + ext;
		if (fs.existsSync(candidate)) {
			if (candidate.startsWith(srcRoot)) {
				return `@/${path.relative(srcRoot, candidate).replace(/\.(tsx?)$/, '')}`;
			}
			if (candidate.startsWith(testRoot)) {
				return `@test/${path.relative(testRoot, candidate).replace(/\.(tsx?)$/, '')}`;
			}
		}
	}
	return spec;
}

const replacements = [
	['@/admin/i18n/', '@/i18n/'],
	['@/admin/test/', '@test/helpers/'],
	['@/admin/components/IdentityMembershipPicker', '@/admin/components/identity/IdentityMembershipPicker'],
	['@/admin/test/renderWithUi', '@test/helpers/renderWithUi'],
];

for (const file of walk(testRoot)) {
	let content = fs.readFileSync(file, 'utf8');
	content = content.replace(/from ['"]([^'"]+)['"]/g, (_, spec) => {
		let next = resolveToAlias(file, spec);
		for (const [from, to] of replacements) {
			if (next === from || next.startsWith(`${from}`)) next = next.replace(from, to);
		}
		return `from '${next}'`;
	});
	fs.writeFileSync(file, content);
}

console.log('Web test imports fixed.');
