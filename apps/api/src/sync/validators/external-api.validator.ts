import { isPasswordHashAlgorithm } from '@nestidp/shared';
import {
	DEFAULT_API_CONTRACT,
	getByPath,
	type ApiContractActiveMapping,
	type ApiContractDefaults,
	type ApiContractNamedFieldMap,
	type ApiContractUserFieldMap,
} from '@nestidp/shared';
import { normalizeSyncedEmail } from '../../identity/utils/normalize-synced-email.util';
import type { ExternalGroupDto, ExternalRoleDto, ExternalUserDto } from '../external-api.types';

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

export { normalizeSyncedEmail } from '../../identity/utils/normalize-synced-email.util';

export interface MapUserOptions {
	fieldMap?: ApiContractUserFieldMap;
	passwordHashAlgorithmConstant?: string | null;
	activeMapping?: ApiContractActiveMapping | null;
	defaults?: ApiContractDefaults;
}

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

/** "username" vs "username (mapped from \"profile.login\")" for debuggable errors. */
function labelFor(canonical: string, source: string): string {
	return source === canonical ? canonical : `${canonical} (mapped from "${source}")`;
}

function readMapped(raw: Record<string, unknown>, sourcePath: string): unknown {
	return getByPath(raw, sourcePath);
}

function coerceActive(
	value: unknown,
	label: string,
	activeMapping: ApiContractActiveMapping | null | undefined,
): boolean {
	let result: boolean;
	if (activeMapping?.trueValues && activeMapping.trueValues.length > 0) {
		const set = new Set(activeMapping.trueValues.map((v) => v.toLowerCase()));
		result = value != null && set.has(String(value).toLowerCase());
	} else if (typeof value === 'boolean') {
		result = value;
	} else if (value === 1 || value === 0) {
		result = value === 1;
	} else if (
		typeof value === 'string' &&
		['true', 'false', '1', '0'].includes(value.toLowerCase())
	) {
		result = value.toLowerCase() === 'true' || value === '1';
	} else {
		throw new ExternalApiValidationError(`Invalid ${label} (must be boolean)`);
	}
	return activeMapping?.inverted ? !result : result;
}

/** Map an external user row through the field map, then run the canonical v1 validation. */
export function mapExternalUserRow(raw: unknown, options: MapUserOptions = {}): ExternalUserDto {
	if (typeof raw !== 'object' || raw === null) {
		throw new ExternalApiValidationError('Invalid user row');
	}
	const row = raw as Record<string, unknown>;
	const fm = options.fieldMap ?? DEFAULT_API_CONTRACT.userFieldMap;
	const defaults = options.defaults ?? {};

	const id = requireNonEmptyString(
		readMapped(row, fm.id),
		labelFor('id', fm.id),
		MAX_EXTERNAL_ID_LENGTH,
	);
	const username = requireNonEmptyString(
		readMapped(row, fm.username),
		labelFor('username', fm.username),
		MAX_USERNAME_LENGTH,
	);
	const passwordHash = requireNonEmptyString(
		readMapped(row, fm.passwordHash),
		labelFor('passwordHash', fm.passwordHash),
		512,
	);
	validatePasswordHash(passwordHash);

	const algorithm =
		options.passwordHashAlgorithmConstant ??
		requireNonEmptyString(
			readMapped(row, fm.passwordHashAlgorithm),
			labelFor('passwordHashAlgorithm', fm.passwordHashAlgorithm),
			32,
		);
	if (!isPasswordHashAlgorithm(algorithm)) {
		throw new ExternalApiValidationError('Unsupported passwordHashAlgorithm');
	}

	const active = coerceActive(
		readMapped(row, fm.active),
		labelFor('active', fm.active),
		options.activeMapping,
	);

	let email: string | null = null;
	const rawEmail = readMapped(row, fm.email);
	if (rawEmail != null) {
		try {
			email = normalizeSyncedEmail(String(rawEmail));
		} catch {
			throw new ExternalApiValidationError(`Invalid ${labelFor('email', fm.email)}`);
		}
	} else if (defaults.email != null) {
		email = normalizeSyncedEmail(defaults.email);
	}

	let displayName: string | null = null;
	const rawDisplayName = readMapped(row, fm.displayName);
	if (rawDisplayName != null) {
		displayName = requireNonEmptyString(
			rawDisplayName,
			labelFor('displayName', fm.displayName),
			MAX_DISPLAY_NAME_LENGTH,
		);
	} else if (defaults.displayNameFromUsername) {
		displayName = username;
	}

	return {
		id,
		username,
		email,
		displayName,
		passwordHash,
		passwordHashAlgorithm: algorithm,
		active,
	};
}

/** Back-compat alias used by the v1 (default-contract) path. */
export function parseExternalUserRow(raw: unknown): ExternalUserDto {
	return mapExternalUserRow(raw);
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

export function mapExternalGroupRow(
	raw: unknown,
	fieldMap: ApiContractNamedFieldMap = DEFAULT_API_CONTRACT.groupFieldMap,
): ExternalGroupDto {
	return mapNamedEntityRow(raw, fieldMap, 'group');
}

export function mapExternalRoleRow(
	raw: unknown,
	fieldMap: ApiContractNamedFieldMap = DEFAULT_API_CONTRACT.roleFieldMap,
): ExternalRoleDto {
	return mapNamedEntityRow(raw, fieldMap, 'role');
}

function mapNamedEntityRow(
	raw: unknown,
	fieldMap: ApiContractNamedFieldMap,
	entity: 'group' | 'role',
): ExternalGroupDto | ExternalRoleDto {
	if (typeof raw !== 'object' || raw === null) {
		throw new ExternalApiValidationError(`Invalid ${entity} row`);
	}
	const row = raw as Record<string, unknown>;
	return {
		id: requireNonEmptyString(
			readMapped(row, fieldMap.id),
			labelFor('id', fieldMap.id),
			MAX_EXTERNAL_ID_LENGTH,
		),
		name: requireNonEmptyString(
			readMapped(row, fieldMap.name),
			labelFor('name', fieldMap.name),
			MAX_NAME_LENGTH,
		),
	};
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
		const user = mapExternalUserRow(row);
		byId.set(user.id, user);
	}
	return Array.from(byId.values());
}

export function parseExternalGroupsJson(body: unknown): ExternalGroupDto[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Groups response must be a JSON array');
	}
	return body.map((row) => mapExternalGroupRow(row));
}

export function parseExternalRolesJson(body: unknown): ExternalRoleDto[] {
	if (!Array.isArray(body)) {
		throw new ExternalApiValidationError('Roles response must be a JSON array');
	}
	return body.map((row) => mapExternalRoleRow(row));
}

/** Mapping-aware duplicate detection (reads the mapped id dot-path). */
export function detectDuplicateUserIds(
	body: unknown,
	idPath = DEFAULT_API_CONTRACT.userFieldMap.id,
): boolean {
	if (!Array.isArray(body)) {
		return false;
	}
	const ids = body
		.map((row) => {
			const value = getByPath(row, idPath);
			return typeof value === 'string' ? value.trim() : null;
		})
		.filter((id): id is string => id != null && id.length > 0);
	return new Set(ids).size !== ids.length;
}
