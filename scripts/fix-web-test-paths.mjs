#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webTest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/test');

const files = [
	'unit/admin/identity-manual-edge.test.tsx',
	'unit/admin/admin-forms-evergreen-edge.test.tsx',
	'unit/i18n/i18n-edge-extended.test.ts',
	'unit/i18n/i18n-edge.test.ts',
	'unit/admin/identity-list-toolbar.test.tsx',
	'unit/admin/identity-ui-edge-extended.test.tsx',
	'unit/ui/evergreen-conventions.test.ts',
	'unit/ui/app-shell-responsive.test.tsx',
	'unit/ui/evergreen-styles.test.ts',
	'unit/ui/evergreen-admin-controls-static.test.ts',
	'unit/ui/Button.test.tsx',
	'unit/ui/responsive-shell-edge-extended.test.tsx',
];

const importLine = "import { evergreenDir, i18nDir, repoRoot, webRoot, webSrc } from '@test/helpers/paths';\n";

for (const rel of files) {
	const file = path.join(webTest, rel);
	let c = fs.readFileSync(file, 'utf8');
	if (c.includes("@test/helpers/paths")) continue;

	c = c.replace(
		/^const webSrc = join\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\);\n/m,
		'',
	);
	c = c.replace(
		/^const evergreenDir = join\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.\/styles\/evergreen'\);\n/m,
		'',
	);
	c = c.replace(/^const evergreenDir = join\(__dirname, '\.\.\/styles\/evergreen'\);\n/m, '');
	c = c.replace(/^const uiDir = dirname\(fileURLToPath\(import\.meta\.url\)\);\nconst webSrc = join\(uiDir, '\.\.'\);\nconst evergreenDir = join\(webSrc, 'styles\/evergreen'\);\n/m, '');
	c = c.replace(/^const i18nDir = import\.meta\.dirname;\nconst webSrc = join\(i18nDir, '\.\.'\);\nconst repoRoot = join\(webSrc, '\.\.\/\.\.\/\.\.'\);\n/m, '');
	c = c.replace(/^const webSrc = join\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\);\nconst repoRoot = resolve\(webSrc, '\.\.\/\.\.\/\.\.'\);\n/m, '');
	c = c.replace(/^const localesDir = join\(i18nDir, 'locales'\);\n/m, "const localesDir = join(i18nDir, 'locales');\n");

	if (!c.includes(importLine.trim())) {
		const idx = c.indexOf('\n', c.indexOf('import '));
		c = c.slice(0, idx + 1) + importLine + c.slice(idx + 1);
	}

	c = c.replace(
		"join(dirname(fileURLToPath(import.meta.url)), 'AppShell.tsx')",
		"join(webSrc, 'ui/AppShell.tsx')",
	);
	c = c.replace(
		"join(webSrc, 'test/setup-i18n.ts')",
		"join(webRoot, 'test/setup/setup-i18n.ts')",
	);
	c = c.replace(
		"join(webSrc, 'test/renderWithUi.tsx')",
		"join(webRoot, 'test/helpers/renderWithUi.tsx')",
	);
	c = c.replace(
		"join(webSrc, 'admin/components/AttributeMappingEditor.tsx')",
		"join(webSrc, 'admin/components/mapping/AttributeMappingEditor.tsx')",
	);
	c = c.replace(
		"join(webSrc, 'admin/components/IdentityMembershipPicker.tsx')",
		"join(webSrc, 'admin/components/identity/IdentityMembershipPicker.tsx')",
	);

	fs.writeFileSync(file, c);
}

console.log('Fixed web test path constants.');
