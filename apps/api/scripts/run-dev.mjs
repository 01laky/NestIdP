#!/usr/bin/env node
/**
 * Nest dev with --watch. Enables TypeScript polling watchers in Docker (bind mounts).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usePolling =
	process.env.CHOKIDAR_USEPOLLING === 'true' ||
	process.env.WATCHPACK_POLLING === 'true' ||
	process.env.FORCE_TSC_POLLING === 'true';

if (usePolling) {
	process.env.TSC_WATCHFILE ??= 'UseFsEventsWithFallbackDynamicPolling';
	process.env.TSC_WATCHDIRECTORY ??= 'UseFsEventsWithFallbackDynamicPolling';
}

const child = spawn('pnpm', ['exec', 'nest', 'start', '--watch'], {
	cwd: apiRoot,
	stdio: 'inherit',
	shell: true,
	env: process.env,
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
