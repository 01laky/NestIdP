import type { SyncLogErrorEntryDto } from '@nestidp/shared';

/**
 * Thin accumulator over the per-run error entries (Prompt 39 D1b). `.add()` makes the two
 * required fields (phase, message) impossible to omit; everything else travels via `opts`.
 * Entries are kept in push order — the order is part of the pinned log behaviour.
 */
export class SyncErrors {
	private readonly entries: SyncLogErrorEntryDto[] = [];

	add(
		phase: SyncLogErrorEntryDto['phase'],
		message: string,
		opts?: Partial<Omit<SyncLogErrorEntryDto, 'phase' | 'message'>>,
	): void {
		this.entries.push({ ...opts, phase, message });
	}

	get length(): number {
		return this.entries.length;
	}

	toArray(): SyncLogErrorEntryDto[] {
		return this.entries;
	}
}
