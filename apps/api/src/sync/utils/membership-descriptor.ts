import type { ExternalGroupDto, ExternalRoleDto } from '../external-api.types';

/** The two membership entity kinds; all phase strings and id fields derive from this. */
export type MembershipEntityKind = 'group' | 'role';

/**
 * Per-run descriptor for one membership kind (Prompt 38 §6.8c / Prompt 39 D6): the groups and
 * roles paths are mirrors of each other — everything that differs between them lives here, so the
 * shared pipeline never branches on the entity. Error phases are deliberately NOT fields: the D3
 * push helpers derive them from `kind`, so a future entity kind cannot silently fork phase
 * strings. Call sites construct descriptors inline with `satisfies MembershipDescriptor`.
 */
export interface MembershipDescriptor {
	kind: MembershipEntityKind;
	mapRow: (
		raw: unknown,
		fieldMap: { id: string; name: string },
	) => ExternalGroupDto | ExternalRoleDto;
	fieldMap: { id: string; name: string };
	embedded: boolean;
	embeddedPath?: string;
	embeddedCap: number | null;
	fetchRaw: (externalUserId: string) => Promise<unknown[]>;
	upsert: (mapped: ExternalGroupDto | ExternalRoleDto) => Promise<{ id: string }>;
	replace: (localUserId: string, memberIds: string[]) => Promise<void>;
	/** Marks the external id as seen this run (drives phase-C orphan deletion). */
	markSeen: (externalId: string) => void;
	/** Counts the upsert once per external id (SyncCounters.addGroupOnce / addRoleOnce). */
	addOnce: (externalId: string) => boolean;
}
