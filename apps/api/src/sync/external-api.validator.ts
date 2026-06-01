import { isPasswordHashAlgorithm } from '@nestidp/shared';
import { normalizeSyncedEmail } from '../identity/normalize-synced-email.util';
import type { ExternalGroupDto, ExternalRoleDto, ExternalUserDto } from './external-api.types';

const MAX_USERNAME_LENGTH = 128;
const MAX_NAME_LENGTH = 128;
const MAX_EXTERNAL_ID_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 256;

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export class ExternalApiValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExternalApiValidationError';
	}
}

export { normalizeSyncedEmail } from '../identity/normalize-synced-email.util';

function requireNonEmptyString(value: unknown, field: string, maxLength: number): string {
	if (typeof value !== 'string') {
		throw new ExternalApiValidationError(`Missing or invalid ${field}`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > maxLength) {
		throw new ExternalApiValidationError(`Invalid ${field}`);
	}
	return trimmed;
}

function validatePasswordHash(value: string): void {
	if (!BCRYPT_PREFIX.test(value)) {
		throw new ExternalApiValidationError('passwordHash must be a bcrypt hash');
	}
}

export function parseExternalUserRow(raw: unknown): ExternalUserDto {
	if (typeof raw !== 'object' || raw === null) {
		throw new ExternalApiValidationError('Invalid user row');
	}
	const row = raw as Record<string, unknown>;
	const id = requireNonEmptyString(row.id, 'id', MAX_EXTERNAL_ID_LENGTH);
	const username = requireNonEmptyString(row.username, 'username', MAX_USERNAME_LENGTH);
	const passwordHash = requireNonEmptyString(row.passwordHash, 'passwordHash', 512);
	const passwordHashAlgorithm = requireNonEmptyString(
		row.passwordHashAlgorithm,
		'passwordHashAlgorithm',
		32,
	);
	if (!isPasswordHashAlgorithm(passwordHashAlgorithm)) {
		throw new ExternalApiValidationError('Unsupported passwordHashAlgorithm');
	}
	validatePasswordHash(passwordHash);
	if (typeof row.active !== 'boolean') {
		throw new ExternalApiValidationError('active must be a boolean');
	}
	let email: string | null = null;
	if (row.email != null) {
		try {
			email = normalizeSyncedEmail(String(row.email));
		} catch {
			throw new ExternalApiValidationError('Invalid email');
		}
	}
	let displayName: string | null = null;
	if (row.displayName != null) {
		displayName = requireNonEmptyString(row.displayName, 'displayName', MAX_DISPLAY_NAME_LENGTH);
	}
	return {
		id,
		username,
		email,
		displayName,
		passwordHash,
		passwordHashAlgorithm,
		active: row.active,
	};
}

export function assertUsersArrayWithinLimit(body: unknown, maxUsers: number): unknown[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Users response must be a JSON array');
	}
	if (body.length > maxUsers) {
		throw new ExternalApiValidationError(`User count exceeds limit of ${maxUsers}`);
	}
	return body;
}

export function parseExternalUsersJson(
	body: unknown,
	options?: { maxUsers?: number },
): ExternalUserDto[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Users response must be a JSON array');
	}
	const maxUsers = options?.maxUsers ?? 10_000;
	if (body.length > maxUsers) {
		throw new ExternalApiValidationError(`User count exceeds limit of ${maxUsers}`);
	}
	const byId = new Map<string, ExternalUserDto>();
	for (const row of body) {
		const user = parseExternalUserRow(row);
		byId.set(user.id, user);
	}
	return Array.from(byId.values());
}

function parseNamedEntityRow(
	raw: unknown,
	entity: 'group' | 'role',
): ExternalGroupDto | ExternalRoleDto {
	if (typeof raw !== 'object' || raw === null) {
		throw new ExternalApiValidationError(`Invalid ${entity} row`);
	}
	const row = raw as Record<string, unknown>;
	return {
		id: requireNonEmptyString(row.id, 'id', MAX_EXTERNAL_ID_LENGTH),
		name: requireNonEmptyString(row.name, 'name', MAX_NAME_LENGTH),
	};
}

export function parseExternalGroupsJson(body: unknown): ExternalGroupDto[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Groups response must be a JSON array');
	}
	return body.map((row) => parseNamedEntityRow(row, 'group') as ExternalGroupDto);
}

export function parseExternalRolesJson(body: unknown): ExternalRoleDto[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Roles response must be a JSON array');
	}
	return body.map((row) => parseNamedEntityRow(row, 'role') as ExternalRoleDto);
}

export function detectDuplicateUserIds(body: unknown): boolean {
	if (!Array.isArray(body)) {
		return false;
	}
	const ids = body
		.map((row) =>
			typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string'
				? (row as { id: string }).id.trim()
				: null,
		)
		.filter((id): id is string => id != null && id.length > 0);
	return new Set(ids).size !== ids.length;
}
