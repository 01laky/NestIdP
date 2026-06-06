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
);
