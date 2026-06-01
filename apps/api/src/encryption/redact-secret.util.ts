export function redactBearerToken(value: string | undefined | null): string {
	if (value == null || value.length === 0 || value.length <= 8) {
		return '[redacted]';
	}
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
