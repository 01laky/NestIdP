/**
 * Parse a config value into a strictly-positive integer, returning `fallback` when the value is absent,
 * non-numeric, or <= 0 (Prompt 38 §6.1 / §A1). This is the second config-parse shape in the codebase
 * (the first, {@link boundedInt}, clamps to an explicit `[min, max]` using `Number()`); this one preserves
 * the `Number.parseInt(String(raw), 10)` + `> 0` semantics that was hand-copied across the session-TTL
 * services, the brute-force rate limiters, the SAML clock-skew reader and the audit-retention config.
 *
 * `parseInt` (not `Number`) is deliberate — it matches the inline copies, which tolerate a trailing-unit
 * suffix (e.g. `"3600s"` -> 3600). `String(null)`/`String(undefined)`/`""` all parse to `NaN` and so fall
 * back, which reproduces every call site's "unset/blank -> default" branch.
 */
export function positiveIntOrDefault(
	raw: string | number | null | undefined,
	fallback: number,
): number {
	const parsed = Number.parseInt(String(raw), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
