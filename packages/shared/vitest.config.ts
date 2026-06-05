import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.spec.ts', 'test/**/*.test.ts'],
	},
	resolve: {
		alias: {
			'@shared': path.resolve(__dirname, './src'),
		},
	},
});
