import { spawnSync } from 'node:child_process';

/**
 * Run the `openssl` CLI with an explicit argv array and **no shell**.
 *
 * SECURITY: every caller passes operator-controlled data (e.g. a certificate CN derived from the IdP
 * entityId) as argv elements. Because there is no shell, shell metacharacters (`"`, `$()`, backticks, `;`,
 * `|`, …) in those values are treated as literal argument bytes and can never inject a command. Do NOT
 * reintroduce a string-interpolated `execSync`/`exec` here.
 *
 * Throws a descriptive error when the binary is missing or exits non-zero (mirrors the previous
 * `execSync` throw-on-failure behaviour so callers' try/finally cleanup is unchanged).
 */
export function runOpenssl(args: readonly string[]): void {
	const result = spawnSync('openssl', args as string[], { stdio: 'pipe' });
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			throw new Error('openssl binary not found on PATH (required for certificate generation)');
		}
		throw new Error(`openssl invocation failed: ${result.error.message}`);
	}
	if (typeof result.status === 'number' && result.status !== 0) {
		const stderr = result.stderr ? result.stderr.toString().trim() : '';
		throw new Error(`openssl exited with status ${result.status}${stderr ? `: ${stderr}` : ''}`);
	}
}
