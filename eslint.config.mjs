import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'**/dist/**',
			'**/coverage/**',
			'**/node_modules/**',
			'mock-app/**',
			'sp-app/**',
			'scripts/restructure-codebase.mjs',
			'scripts/fix-api-imports.mjs',
			'scripts/fix-web-test-imports.mjs',
			'scripts/fix-web-test-paths.mjs',
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	eslintConfigPrettier,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		files: ['**/test/**/*.{ts,tsx}', 'apps/api/test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},
	{
		files: ['apps/web/**/*.{ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.browser,
			},
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
		},
	},
	// §13 import boundaries — keep the layering fixes permanent (Prompt 38).
	{
		// End-user auth and bootstrap must not reach into the admin-auth module: the shared
		// crypto/session primitives they need live in common/ (password.util moved to
		// common/crypto in §6.5) — re-importing admin-auth re-couples the two auth stacks.
		files: ['apps/api/src/auth/**/*.ts', 'apps/api/src/bootstrap/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/admin-auth/**'],
							message:
								'auth/bootstrap must not import admin-auth — shared primitives live in common/ (Prompt 38 §13).',
						},
					],
				},
			],
		},
	},
	{
		// And the reverse: the admin-auth stack must not depend on the end-user auth module.
		files: ['apps/api/src/admin-auth/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/src/auth/**', '../auth/**', '../../auth/**'],
							message:
								'admin-auth must not import the end-user auth module — shared primitives live in common/ (Prompt 38 §13).',
						},
					],
				},
			],
		},
	},
	{
		// The external (PostgreSQL) identity store must stay Prisma-free: it may only depend on the
		// neutral store contracts/errors, never on the Prisma-bound local repository.
		files: ['apps/api/src/identity/store/external/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/identity.repository', '**/identity.repository.*'],
							message:
								'the external store must not import the Prisma-bound identity.repository — use the neutral store contracts (Prompt 38 §13).',
						},
					],
				},
			],
		},
	},
	{
		// The browser SPA must never import server-only dependencies (pairs with the §19
		// bundle-hygiene scan, which catches transitive leaks in the built chunks).
		files: ['apps/web/src/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'cron-parser',
							message:
								'import the cron helpers from @nestidp/shared instead of cron-parser directly (Prompt 38 §13/§19).',
						},
					],
					patterns: [
						{
							group: [
								'@nestjs/*',
								'@prisma/*',
								'@libsql/*',
								'kysely',
								'pg',
								'pg-*',
								'bcryptjs',
								'xml-crypto',
								'xmlbuilder2',
								'@xmldom/*',
							],
							message: 'server-only dependency — must not be imported by the SPA (Prompt 38 §13).',
						},
					],
				},
			],
		},
	},
);
