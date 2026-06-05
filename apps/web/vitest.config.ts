/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@test': path.resolve(__dirname, './test'),
			'@nestidp/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['test/**/*.test.{ts,tsx}'],
		setupFiles: ['test/setup/setup-i18n.ts'],
		pool: 'forks',
		maxWorkers: 4,
		minWorkers: 1,
		teardownTimeout: 15_000,
		hookTimeout: 30_000,
		testTimeout: 60_000,
	},
});
