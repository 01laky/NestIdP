/**
 * Parse an environment value into a number, returning `fallback` when the value is absent, empty/whitespace,
 * non-finite, OR outside [min, max] (Prompt 38 §6.1 / §A1). This matches the semantics of the ~15 inline
 * `boundedInt` copies it replaces (value-in-range → use it, else → fallback), with one fix:
 *
 * explicit empty-string handling. `Number('')` is `0`, so the inline copies turned an empty env var into
 * `0`; for a knob with `min === 0` (scheduler tick, jitter, grace) that `0` silently DISABLED the feature
 * instead of using its default. Treating empty/whitespace as "unset" here returns the fallback as intended.
 */
export function boundedInt(
	raw: string | number | null | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (raw === null || raw === undefined) {
		return fallback;
	}
	const str = String(raw).trim();
	if (str === '') {
		return fallback;
	}
	const parsed = Number(str);
	if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
		return parsed;
	}
	return fallback;
}
