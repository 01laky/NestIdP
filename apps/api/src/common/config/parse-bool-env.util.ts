/**
 * Parse a truthy environment value (Prompt 38 §6.1 / §A2). Accepts `1`, `true`, `yes`, `on`
 * (case-insensitive); everything else — including absent/empty — is the `fallback` (default `false`).
 * Replaces the ad-hoc `['1','true','yes'].includes(...)` checks scattered across the schedulers and main.ts.
 */
export function parseBoolEnv(raw: string | null | undefined, fallback = false): boolean {
	if (raw === null || raw === undefined) {
		return fallback;
	}
	const str = raw.trim().toLowerCase();
	if (str === '') {
		return fallback;
	}
	return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}
