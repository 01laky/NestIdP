import type { SyncLogErrorEntryDto } from '@nestidp/shared';
import {
	GroupNameCollisionError,
	RoleNameCollisionError,
} from '../../identity/identity.repository';
import { IdentitySyncHttpError } from '../identity-sync.errors';
import { ExternalApiValidationError } from '../validators/external-api.validator';

/**
 * Per-kind asymmetries of the group/role membership mirror (Prompt 38 §6.8): the two paths are
 * identical except for the phase names, the error-entry id field and the name-collision error class.
 */
export interface MembershipErrorDescriptor {
	upsertPhase: 'upsert_group' | 'upsert_role';
	errorIdField: 'externalGroupId' | 'externalRoleId';
	invalidRowMessage: string;
	upsertFailedMessage: string;
	isNameCollision: (error: unknown) => error is Error;
}

export const GROUP_ERROR_DESCRIPTOR: MembershipErrorDescriptor = {
	upsertPhase: 'upsert_group',
	errorIdField: 'externalGroupId',
	invalidRowMessage: 'Invalid group row',
	upsertFailedMessage: 'Failed to upsert group',
	isNameCollision: (error): error is GroupNameCollisionError =>
		error instanceof GroupNameCollisionError,
};

export const ROLE_ERROR_DESCRIPTOR: MembershipErrorDescriptor = {
	upsertPhase: 'upsert_role',
	errorIdField: 'externalRoleId',
	invalidRowMessage: 'Invalid role row',
	upsertFailedMessage: 'Failed to upsert role',
	isNameCollision: (error): error is RoleNameCollisionError =>
		error instanceof RoleNameCollisionError,
};

export function pushFetchUsersError(errors: SyncLogErrorEntryDto[], error: unknown): void {
	if (error instanceof ExternalApiValidationError) {
		errors.push({
			phase: error.message.includes('limit') ? 'user_limit' : 'fetch_users',
			message: error.message,
		});
		return;
	}
	if (error instanceof IdentitySyncHttpError) {
		const phase: SyncLogErrorEntryDto['phase'] = error.message.includes('limit')
			? 'user_limit'
			: 'fetch_users';
		errors.push({
			phase,
			message: error.message,
			httpStatus: error.options.statusCode,
		});
		return;
	}
	errors.push({ phase: 'fetch_users', message: 'Failed to fetch users' });
}

export function pushUpsertUserError(errors: SyncLogErrorEntryDto[], externalUserId: string): void {
	errors.push({
		phase: 'upsert_user',
		externalUserId,
		message: 'Failed to upsert user',
	});
}

export function pushMembershipFetchError(
	errors: SyncLogErrorEntryDto[],
	phase: 'fetch_groups' | 'fetch_roles',
	externalUserId: string,
	error: unknown,
): void {
	errors.push({
		phase,
		externalUserId,
		message:
			error instanceof IdentitySyncHttpError
				? error.message
				: `Failed to fetch ${phase === 'fetch_groups' ? 'groups' : 'roles'}`,
		httpStatus: error instanceof IdentitySyncHttpError ? error.options.statusCode : undefined,
	});
}

export function pushMembershipRowParseError(
	errors: SyncLogErrorEntryDto[],
	descriptor: MembershipErrorDescriptor,
	externalUserId: string,
	error: unknown,
): void {
	errors.push({
		phase: descriptor.upsertPhase,
		externalUserId,
		message:
			error instanceof ExternalApiValidationError ? error.message : descriptor.invalidRowMessage,
	});
}

export function pushUpsertEntityError(
	errors: SyncLogErrorEntryDto[],
	descriptor: MembershipErrorDescriptor,
	externalUserId: string,
	externalEntityId: string,
	error: unknown,
): void {
	const entry: SyncLogErrorEntryDto = {
		phase: descriptor.upsertPhase,
		externalUserId,
		message: descriptor.isNameCollision(error) ? error.message : descriptor.upsertFailedMessage,
	};
	entry[descriptor.errorIdField] = externalEntityId;
	errors.push(entry);
}
