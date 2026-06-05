#!/usr/bin/env node
/**
 * One-off migration: separate tests from src, nest API modules, group web components.
 * Run from repo root: node scripts/restructure-codebase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walkFiles(dir, filter) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walkFiles(p, filter));
		else if (!filter || filter(p)) out.push(p);
	}
	return out;
}

function read(p) {
	return fs.readFileSync(p, 'utf8');
}

function write(p, content) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
}

function moveFile(from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	if (fs.existsSync(to)) fs.unlinkSync(to);
	fs.renameSync(from, to);
}

/** Resolve relative import from dir; return path relative to baseDir (posix). */
function resolveRelativeImport(fromDir, spec) {
	if (!spec.startsWith('.')) return null;
	const target = path.resolve(fromDir, spec);
	const rel = path.relative(path.dirname(fromDir), target);
	return rel.split(path.sep).join('/');
}

function toApiImport(fromDir, spec, srcRoot) {
	const rel = resolveRelativeImport(fromDir, spec);
	if (rel == null) return spec;
	const abs = path.resolve(fromDir, spec);
	let fromSrc = path.relative(srcRoot, abs).split(path.sep).join('/');
	if (fromSrc.endsWith('.ts')) fromSrc = fromSrc.slice(0, -3);
	return `@api/${fromSrc}`;
}

function rewriteApiTestImports(content, oldSpecDir, srcRoot) {
	return content.replace(/from ['"](\.[^'"]+)['"]/g, (_, spec) => {
		const mapped = toApiImport(oldSpecDir, spec, srcRoot);
		return `from '${mapped}'`;
	});
}

function rewriteApiSrcImports(content, filePath, srcRoot, pathMap) {
	return content.replace(/from ['"]([^'"]+)['"]/g, (_, spec) => {
		if (!spec.startsWith('.')) return `from '${spec}'`;
		const abs = path.resolve(path.dirname(filePath), spec);
		const oldRel = path.relative(srcRoot, abs).split(path.sep).join('/');
		const oldKey = oldRel.replace(/\.ts$/, '');
		const mapped = pathMap.get(oldKey);
		if (mapped) {
			const fromFile = path.dirname(filePath);
			const newAbs = path.join(srcRoot, mapped + '.ts');
			let rel = path.relative(fromFile, newAbs).split(path.sep).join('/');
			if (!rel.startsWith('.')) rel = `./${rel}`;
			if (rel.endsWith('.ts')) rel = rel.slice(0, -3);
			return `from '${rel}'`;
		}
		return `from '${spec}'`;
	});
}

// --- Phase 1: move API test-only support out of src ---
function migrateApiTestSupport() {
	const apiRoot = path.join(repoRoot, 'apps/api');
	const srcRoot = path.join(apiRoot, 'src');
	const supportRoot = path.join(apiRoot, 'test/support');

	const moves = [
		['src/prisma/test-fixtures.ts', 'support/prisma/test-fixtures.ts'],
		['src/prisma/test-db.helper.ts', 'support/prisma/test-db.helper.ts'],
		['src/saml/testing/build-authn-request.util.ts', 'support/saml/build-authn-request.util.ts'],
		['src/saml/testing/verify-saml-signature.util.ts', 'support/saml/verify-saml-signature.util.ts'],
	];

	for (const [from, to] of moves) {
		moveFile(path.join(apiRoot, from), path.join(apiRoot, to));
	}

	// Fix imports inside moved support files
	const tf = path.join(apiRoot, 'support/prisma/test-fixtures.ts');
	let tfContent = read(tf);
	tfContent = tfContent.replace(
		"from '../saml/testing/build-authn-request.util'",
		"from '../saml/build-authn-request.util'",
	);
	write(tf, tfContent);
}

// --- Phase 2: move all API *.spec.ts to test/unit ---
function migrateApiTests() {
	const apiRoot = path.join(repoRoot, 'apps/api');
	const srcRoot = path.join(apiRoot, 'src');
	const unitRoot = path.join(apiRoot, 'test/unit');

	const specs = walkFiles(srcRoot, (p) => p.endsWith('.spec.ts'));
	for (const specPath of specs) {
		const rel = path.relative(srcRoot, specPath);
		const dest = path.join(unitRoot, rel);
		let content = read(specPath);
		const oldDir = path.dirname(specPath);
		content = rewriteApiTestImports(content, oldDir, srcRoot);
		content = content.replaceAll('@api/prisma/test-fixtures', '@test/support/prisma/test-fixtures');
		content = content.replaceAll('@api/prisma/test-db.helper', '@test/support/prisma/test-db.helper');
		content = content.replaceAll(
			/@api\/saml\/testing\/([\w.-]+)/g,
			'@test/support/saml/$1',
		);
		write(dest, content);
		fs.unlinkSync(specPath);
	}

	// Remove empty saml/testing dir
	const testingDir = path.join(srcRoot, 'saml/testing');
	if (fs.existsSync(testingDir)) {
		try {
			fs.rmdirSync(testingDir);
		} catch {
			/* not empty */
		}
	}
}

// --- Phase 3: API module subfolders ---
const API_SUBFOLDER_RULES = [
	[/\.controller\.ts$/, 'controllers'],
	[/\.service\.ts$/, 'services'],
	[/\.dto\.ts$/, 'dto'],
	[/\.util\.ts$/, 'utils'],
	[/\.validator\.ts$/, 'validators'],
	[/\.guard\.ts$/, 'guards'],
	[/\.pipe\.ts$/, 'pipes'],
	[/\.mapper\.ts$/, 'mappers'],
];

function classifyApiFile(name) {
	for (const [re, folder] of API_SUBFOLDER_RULES) {
		if (re.test(name)) return folder;
	}
	return null;
}

function migrateApiModules() {
	const srcRoot = path.join(repoRoot, 'apps/api/src');
	const pathMap = new Map();

	const moduleDirs = fs
		.readdirSync(srcRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => path.join(srcRoot, d.name));

	for (const modDir of moduleDirs) {
		const files = fs.readdirSync(modDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.module.ts'));
		for (const file of files) {
			const sub = classifyApiFile(file);
			if (!sub) continue;
			const from = path.join(modDir, file);
			const to = path.join(modDir, sub, file);
			const modName = path.basename(modDir);
			const oldKey = `${modName}/${file.replace(/\.ts$/, '')}`;
			const newKey = `${modName}/${sub}/${file.replace(/\.ts$/, '')}`;
			pathMap.set(oldKey, newKey);
			moveFile(from, to);
		}
	}

	// http-security at src root
	const httpSec = path.join(srcRoot, 'http-security.ts');
	if (fs.existsSync(httpSec)) {
		const utilsDir = path.join(srcRoot, 'common', 'utils');
		moveFile(httpSec, path.join(utilsDir, 'http-security.ts'));
		pathMap.set('http-security', 'common/utils/http-security');
	}

	// Rewrite all src ts imports
	const allTs = walkFiles(srcRoot, (p) => p.endsWith('.ts'));
	for (const file of allTs) {
		write(file, rewriteApiSrcImports(read(file), file, srcRoot, pathMap));
	}

	// Rewrite test unit imports for @api paths
	const unitRoot = path.join(repoRoot, 'apps/api/test/unit');
	const allSpecs = walkFiles(unitRoot, (p) => p.endsWith('.spec.ts'));
	for (const file of allSpecs) {
		let c = read(file);
		for (const [oldKey, newKey] of pathMap) {
			c = c.replaceAll(`@api/${oldKey}`, `@api/${newKey}`);
		}
		c = c.replaceAll('@api/http-security', '@api/common/utils/http-security');
		write(file, c);
	}
}

// --- Phase 4: web component folders ---
const WEB_COMPONENT_MAP = {
	'ErrorBanner.tsx': 'common/ErrorBanner.tsx',
	'LoadingState.tsx': 'common/LoadingState.tsx',
	'EmptyState.tsx': 'common/EmptyState.tsx',
	'AdminBreadcrumbs.tsx': 'layout/AdminBreadcrumbs.tsx',
	'AdminPageHeader.tsx': 'layout/AdminPageHeader.tsx',
	'IdentityListTable.tsx': 'identity/IdentityListTable.tsx',
	'IdentityListTable.edge.test.tsx': 'identity/IdentityListTable.edge.test.tsx',
	'identityListTableLazy.ts': 'identity/identityListTableLazy.ts',
	'IdentitySectionNav.tsx': 'identity/IdentitySectionNav.tsx',
	'IdentitySectionNav.test.tsx': 'identity/IdentitySectionNav.test.tsx',
	'IdentityMembershipPicker.tsx': 'identity/IdentityMembershipPicker.tsx',
	'AttributeMappingEditor.tsx': 'mapping/AttributeMappingEditor.tsx',
	'AttributeMappingEditor.test.tsx': 'mapping/AttributeMappingEditor.test.tsx',
	'AttributeMappingEditor.evergreen-edge.test.tsx':
		'mapping/AttributeMappingEditor.evergreen-edge.test.tsx',
	'AttributeMappingEditor.evergreen-forms.test.tsx':
		'mapping/AttributeMappingEditor.evergreen-forms.test.tsx',
	'sp-mapping-presets.ts': 'mapping/constants.ts',
	'IdpSigningCertOptionsFields.tsx': 'idp-cert/IdpSigningCertOptionsFields.tsx',
	'IdpSigningCertOptionsFields.test.tsx': 'idp-cert/IdpSigningCertOptionsFields.test.tsx',
	'IdpEncryptionCertOptionsFields.tsx': 'idp-cert/IdpEncryptionCertOptionsFields.tsx',
	'IdpEncryptionCertOptionsFields.test.tsx': 'idp-cert/IdpEncryptionCertOptionsFields.test.tsx',
	'useDocumentTitle.ts': 'hooks/useDocumentTitle.ts',
	'useDocumentTitle.test.tsx': 'hooks/useDocumentTitle.test.tsx',
};

function migrateWebComponents() {
	const compRoot = path.join(repoRoot, 'apps/web/src/admin/components');
	for (const [name, destRel] of Object.entries(WEB_COMPONENT_MAP)) {
		const from = path.join(compRoot, name);
		if (!fs.existsSync(from)) continue;
		moveFile(from, path.join(compRoot, destRel));
	}
}

// --- Phase 5: move web tests ---
function migrateWebTests() {
	const webRoot = path.join(repoRoot, 'apps/web');
	const srcRoot = path.join(webRoot, 'src');
	const unitRoot = path.join(webRoot, 'test/unit');

	const tests = walkFiles(srcRoot, (p) => /\.test\.(ts|tsx)$/.test(p));
	for (const testPath of tests) {
		const rel = path.relative(srcRoot, testPath);
		const dest = path.join(unitRoot, rel);
		let content = read(testPath);
		const oldDir = path.dirname(testPath);
		content = content.replace(/from ['"](\.[^'"]+)['"]/g, (_, spec) => {
			const abs = path.resolve(oldDir, spec);
			let fromSrc = path.relative(srcRoot, abs).split(path.sep).join('/');
			if (/\.(tsx?|jsx?)$/.test(fromSrc)) {
				fromSrc = fromSrc.replace(/\.(tsx?|jsx?)$/, '');
			}
			return `from '@/${fromSrc}'`;
		});
		write(dest, content);
		fs.unlinkSync(testPath);
	}

	// test helpers
	moveFile(
		path.join(srcRoot, 'test/setup-i18n.ts'),
		path.join(webRoot, 'test/setup/setup-i18n.ts'),
	);
	for (const f of ['renderWithUi.tsx', 'confirm-dialog-helpers.ts']) {
		const from = path.join(srcRoot, 'test', f);
		if (fs.existsSync(from)) {
			moveFile(from, path.join(webRoot, 'test/helpers', f));
		}
	}
}

function rewriteWebImports() {
	const srcRoot = path.join(repoRoot, 'apps/web/src');
	const all = walkFiles(srcRoot, (p) => /\.(tsx?)$/.test(p));

	const replacements = [
		["from '../components/ErrorBanner'", "from '../components/common/ErrorBanner'"],
		["from '../components/LoadingState'", "from '../components/common/LoadingState'"],
		["from '../components/EmptyState'", "from '../components/common/EmptyState'"],
		["from '../components/AdminBreadcrumbs'", "from '../components/layout/AdminBreadcrumbs'"],
		["from '../components/AdminPageHeader'", "from '../components/layout/AdminPageHeader'"],
		["from '../components/IdentitySectionNav'", "from '../components/identity/IdentitySectionNav'"],
		[
			"from '../components/identityListTableLazy'",
			"from '../components/identity/identityListTableLazy'",
		],
		[
			"from '../components/IdentityMembershipPicker'",
			"from '../components/identity/IdentityMembershipPicker'",
		],
		[
			"from '../components/AttributeMappingEditor'",
			"from '../components/mapping/AttributeMappingEditor'",
		],
		[
			"from '../components/IdpEncryptionCertOptionsFields'",
			"from '../components/idp-cert/IdpEncryptionCertOptionsFields'",
		],
		[
			"from '../components/IdpSigningCertOptionsFields'",
			"from '../components/idp-cert/IdpSigningCertOptionsFields'",
		],
		["from './components/IdentityMembershipPicker'", "from './components/identity/IdentityMembershipPicker'"],
		["from '../admin/components/useDocumentTitle'", "from '../admin/components/hooks/useDocumentTitle'"],
		["sp-mapping-presets", 'mapping/constants'],
	];

	for (const file of all) {
		let c = read(file);
		let changed = false;
		for (const [from, to] of replacements) {
			if (c.includes(from)) {
				c = c.split(from).join(to);
				changed = true;
			}
		}
		if (changed) write(file, c);
	}

	// Fix tests under test/unit
	const unitRoot = path.join(repoRoot, 'apps/web/test/unit');
	for (const file of walkFiles(unitRoot, (p) => /\.(tsx?)$/.test(p))) {
		let c = read(file);
		for (const [from, to] of replacements) {
			c = c.split(from).join(to);
		}
		c = c.replaceAll('@/test/setup-i18n', '@test/setup/setup-i18n');
		c = c.replaceAll('@/test/renderWithUi', '@test/helpers/renderWithUi');
		c = c.replaceAll('@/test/confirm-dialog-helpers', '@test/helpers/confirm-dialog-helpers');
		c = c.replaceAll('@/admin/components/IdpEncryptionCertOptionsFields', '@/admin/components/idp-cert/IdpEncryptionCertOptionsFields');
		c = c.replaceAll('@/admin/components/IdpSigningCertOptionsFields', '@/admin/components/idp-cert/IdpSigningCertOptionsFields');
		c = c.replaceAll('@/admin/components/AttributeMappingEditor', '@/admin/components/mapping/AttributeMappingEditor');
		c = c.replaceAll('@/admin/components/IdentitySectionNav', '@/admin/components/identity/IdentitySectionNav');
		c = c.replaceAll('@/admin/components/sp-mapping-presets', '@/admin/components/mapping/constants');
		write(file, c);
	}
}

// --- Phase 6: shared tests ---
function migrateSharedTests() {
	const pkg = path.join(repoRoot, 'packages/shared');
	const srcRoot = path.join(pkg, 'src');
	const testRoot = path.join(pkg, 'test');

	for (const spec of walkFiles(srcRoot, (p) => p.endsWith('.spec.ts') || p.endsWith('.test.ts'))) {
		const rel = path.relative(srcRoot, spec);
		let content = read(spec);
		content = content.replace(/from ['"](\.[^'"]+)['"]/g, (_, specImport) => {
			const abs = path.resolve(path.dirname(spec), specImport);
			let fromSrc = path.relative(srcRoot, abs).split(path.sep).join('/');
			if (fromSrc.endsWith('.ts')) fromSrc = fromSrc.slice(0, -3);
			return `from '@shared/${fromSrc}'`;
		});
		write(path.join(testRoot, rel), content);
		fs.unlinkSync(spec);
	}
}

console.log('Phase 1: API test support...');
migrateApiTestSupport();
console.log('Phase 2: API tests...');
migrateApiTests();
console.log('Phase 3: API modules...');
migrateApiModules();
console.log('Phase 4: Web components...');
migrateWebComponents();
console.log('Phase 5: Web tests...');
migrateWebTests();
console.log('Phase 6: Web import fixes...');
rewriteWebImports();
console.log('Phase 7: Shared tests...');
migrateSharedTests();
console.log('Done. Update jest/vitest configs and run tests.');
