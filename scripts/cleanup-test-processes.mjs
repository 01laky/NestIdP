#!/usr/bin/env node
/**
 * Kill stale Vitest/Jest/Playwright processes for this monorepo.
 * Safe to run anytime (pnpm test:cleanup). Called automatically via pre/posttest hooks.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function psLines() {
	try {
		return execSync('ps -ww -eo pid=,command=', {
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		})
			.split('\n')
			.filter(Boolean);
	} catch {
		return [];
	}
}

function parsePid(line) {
	const match = line.trim().match(/^(\d+)\s+(.*)$/);
	if (!match) {
		return null;
	}
	return { pid: Number(match[1]), command: match[2] };
}

function repoScopedTestPids() {
	const pids = [];
	for (const line of psLines()) {
		const row = parsePid(line);
		if (!row || !row.command.includes(repoRoot)) {
			continue;
		}
		if (/\b(vitest|jest|playwright)\b/i.test(row.command)) {
			pids.push(row.pid);
		}
	}
	return pids;
}

function hasActiveRepoVitestRunner() {
	return psLines().some((line) => {
		const row = parsePid(line);
		if (!row || !row.command.includes(repoRoot)) {
			return false;
		}
		return /\bvitest\s+(run|watch)\b/.test(row.command);
	});
}

/** Workers like `node (vitest 3)` left behind when the parent Vitest CLI was killed. */
function orphanVitestWorkerPids() {
	if (hasActiveRepoVitestRunner()) {
		return [];
	}
	const pids = [];
	for (const line of psLines()) {
		const row = parsePid(line);
		if (!row) {
			continue;
		}
		if (/\(vitest\s+\d+\)/.test(row.command) || /\bvitest\b/i.test(row.command)) {
			pids.push(row.pid);
		}
	}
	return pids;
}

function killPids(pids) {
	const unique = [...new Set(pids.filter((n) => Number.isInteger(n) && n > 1))];
	if (!unique.length) {
		return 0;
	}
	for (const pid of unique) {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			/* already exited */
		}
	}
	try {
		execSync('sleep 0.25');
	} catch {
		/* windows / fast machines */
	}
	for (const pid of unique) {
		try {
			process.kill(pid, 0);
			process.kill(pid, 'SIGKILL');
		} catch {
			/* gone */
		}
	}
	return unique.length;
}

export function cleanupTestProcesses({ quiet = false } = {}) {
	const pids = [...repoScopedTestPids(), ...orphanVitestWorkerPids()];
	const killed = killPids(pids);
	if (killed && !quiet) {
		console.warn(`[nestidp] stopped ${killed} stale test process(es)`);
	}
	return killed;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	cleanupTestProcesses();
}
