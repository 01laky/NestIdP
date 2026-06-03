import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true';

export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		port: 5173,
		watch: usePolling ? { usePolling: true, interval: 1000 } : undefined,
		proxy: {
			'/api': { target: apiTarget, changeOrigin: true },
			'/saml': { target: apiTarget, changeOrigin: true },
			'/health': { target: apiTarget, changeOrigin: true },
			'/ready': { target: apiTarget, changeOrigin: true },
		},
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
});
