import {
	GroupNameCollisionError,
	RoleNameCollisionError,
} from '../../identity/identity.repository';
import { IdentitySyncHttpError } from '../identity-sync.errors';
import type { MembershipEntityKind } from '../utils/membership-descriptor';
import type { SyncErrors } from '../utils/sync-errors';
import { ExternalApiValidationError } from '../validators/external-api.validator';

/**
 * Per-kind asymmetries of the group/role membership mirror (Prompt 38 §6.8 / Prompt 39 D3): the
 * two paths are identical except for the phase names, the error-entry id field and the
 * name-collision error class. Internal — callers pass a `kind`, never a phase string.
 */
interface MembershipErrorDescriptor {
	fetchPhase: 'fetch_groups' | 'fetch_roles';
	upsertPhase: 'upsert_group' | 'upsert_role';
	fetchFailedMessage: string;
	invalidRowMessage: string;
	upsertFailedMessage: string;
	isNameCollision: (error: unknown) => error is Error;
}

const DESCRIPTORS: Record<MembershipEntityKind, MembershipErrorDescriptor> = {
	group: {
		fetchPhase: 'fetch_groups',
		upsertPhase: 'upsert_group',
		fetchFailedMessage: 'Failed to fetch groups',
		invalidRowMessage: 'Invalid group row',
		upsertFailedMessage: 'Failed to upsert group',
		isNameCollision: (error): error is GroupNameCollisionError =>
			error instanceof GroupNameCollisionError,
	},
	role: {
		fetchPhase: 'fetch_roles',
		upsertPhase: 'upsert_role',
		fetchFailedMessage: 'Failed to fetch roles',
		invalidRowMessage: 'Invalid role row',
		upsertFailedMessage: 'Failed to upsert role',
		isNameCollision: (error): error is RoleNameCollisionError =>
			error instanceof RoleNameCollisionError,
	},
};

export function pushFetchUsersError(errors: SyncErrors, error: unknown): void {
	if (error instanceof ExternalApiValidationError) {
		errors.add(error.message.includes('limit') ? 'user_limit' : 'fetch_users', error.message);
		return;
	}
	if (error instanceof IdentitySyncHttpError) {
		errors.add(error.message.includes('limit') ? 'user_limit' : 'fetch_users', error.message, {
			httpStatus: error.options.statusCode,
		});
		return;
	}
	errors.add('fetch_users', 'Failed to fetch users');
}

export function pushUpsertUserError(errors: SyncErrors, externalUserId: string): void {
	errors.add('upsert_user', 'Failed to upsert user', { externalUserId });
}

export function pushMembershipFetchError(
	errors: SyncErrors,
	kind: MembershipEntityKind,
	externalUserId: string,
	error: unknown,
): void {
	const descriptor = DESCRIPTORS[kind];
	errors.add(
		descriptor.fetchPhase,
		error instanceof IdentitySyncHttpError ? error.message : descriptor.fetchFailedMessage,
		{
			externalUserId,
			httpStatus: error instanceof IdentitySyncHttpError ? error.options.statusCode : undefined,
		},
	);
}

export function pushMembershipRowParseError(
	errors: SyncErrors,
	kind: MembershipEntityKind,
	externalUserId: string,
	error: unknown,
): void {
	const descriptor = DESCRIPTORS[kind];
	errors.add(
		descriptor.upsertPhase,
		error instanceof ExternalApiValidationError ? error.message : descriptor.invalidRowMessage,
		{ externalUserId },
	);
}

export function pushUpsertEntityError(
	errors: SyncErrors,
	kind: MembershipEntityKind,
	externalUserId: string,
	externalEntityId: string,
	error: unknown,
): void {
	const descriptor = DESCRIPTORS[kind];
	errors.add(
		descriptor.upsertPhase,
		descriptor.isNameCollision(error) ? error.message : descriptor.upsertFailedMessage,
		{
			externalUserId,
			...(kind === 'group'
				? { externalGroupId: externalEntityId }
				: { externalRoleId: externalEntityId }),
		},
	);
}
