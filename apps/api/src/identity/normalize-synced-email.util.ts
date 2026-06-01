export function normalizeSyncedEmail(raw: string | null | undefined): string | null {
	if (raw == null) {
		return null;
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const normalized = trimmed.toLowerCase();
	if (!normalized.includes('@') || normalized.length > 256) {
		throw new Error('Invalid email');
	}
	return normalized;
}
