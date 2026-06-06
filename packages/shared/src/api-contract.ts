/**
 * Per-API-connection contract: configurable endpoint paths, JSON field mapping,
 * response envelope, pagination, headers, and membership sourcing (v1.9.0).
 *
 * `null` config ⇒ the fixed v1 contract (`DEFAULT_API_CONTRACT`). All parts are
 * optional and deep-merge over the defaults via `resolveApiContract`.
 */

export type ApiMembershipMode = 'endpoint' | 'embedded';
export type ApiPaginationMode = 'none' | 'offset' | 'page';
export type ApiRowErrorPolicy = 'fail' | 'skip';

export interface ApiContractEndpoints {
	usersPath: string;
	userGroupsPath: string;
	userRolesPath: string;
}

export interface ApiContractResponseRoot {
	users: string;
	groups: string;
	roles: string;
}

export interface ApiContractUserFieldMap {
	id: string;
	username: string;
	email: string;
	displayName: string;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: string;
}

export interface ApiContractNamedFieldMap {
	id: string;
	name: string;
}

export interface ApiMembershipSourceEntry {
	mode: ApiMembershipMode;
	embeddedPath?: string;
}

export interface ApiContractPagination {
	mode: ApiPaginationMode;
	limitParam?: string;
	offsetParam?: string;
	pageParam?: string;
	pageSize?: number;
	startPage?: number;
	maxPages?: number;
}

export interface ApiContractActiveMapping {
	inverted?: boolean;
	trueValues?: string[];
}

export interface ApiContractDefaults {
	displayNameFromUsername?: boolean;
	email?: string | null;
}

/** Operator-supplied (sparse) configuration stored on the connection. */
export interface ApiContractConfig {
	endpoints?: Partial<ApiContractEndpoints>;
	responseRoot?: Partial<ApiContractResponseRoot>;
	userFieldMap?: Partial<ApiContractUserFieldMap>;
	passwordHashAlgorithmConstant?: string | null;
	groupFieldMap?: Partial<ApiContractNamedFieldMap>;
	roleFieldMap?: Partial<ApiContractNamedFieldMap>;
	queryParams?: Record<string, string>;
	headers?: Record<string, string>;
	membershipSource?: {
		groups?: ApiMembershipSourceEntry;
		roles?: ApiMembershipSourceEntry;
	};
	pagination?: ApiContractPagination;
	activeMapping?: ApiContractActiveMapping;
	onRowError?: ApiRowErrorPolicy;
	defaults?: ApiContractDefaults;
	maxGroupsPerUser?: number;
	maxRolesPerUser?: number;
}

/** Fully-populated effective contract used by the sync runtime. */
export interface ResolvedApiContract {
	endpoints: ApiContractEndpoints;
	responseRoot: ApiContractResponseRoot;
	userFieldMap: ApiContractUserFieldMap;
	groupFieldMap: ApiContractNamedFieldMap;
	roleFieldMap: ApiContractNamedFieldMap;
	passwordHashAlgorithmConstant: string | null;
	queryParams: Record<string, string>;
	headers: Record<string, string>;
	membershipSource: { groups: ApiMembershipSourceEntry; roles: ApiMembershipSourceEntry };
	pagination: ApiContractPagination;
	activeMapping: ApiContractActiveMapping | null;
	onRowError: ApiRowErrorPolicy;
	defaults: ApiContractDefaults;
	maxGroupsPerUser: number | null;
	maxRolesPerUser: number | null;
}

export const DEFAULT_API_CONTRACT: ResolvedApiContract = {
	endpoints: {
		usersPath: '/users',
		userGroupsPath: '/users/:id/groups',
		userRolesPath: '/users/:id/roles',
	},
	responseRoot: { users: '', groups: '', roles: '' },
	userFieldMap: {
		id: 'id',
		username: 'username',
		email: 'email',
		displayName: 'displayName',
		passwordHash: 'passwordHash',
		passwordHashAlgorithm: 'passwordHashAlgorithm',
		active: 'active',
	},
	groupFieldMap: { id: 'id', name: 'name' },
	roleFieldMap: { id: 'id', name: 'name' },
	passwordHashAlgorithmConstant: null,
	queryParams: {},
	headers: {},
	membershipSource: { groups: { mode: 'endpoint' }, roles: { mode: 'endpoint' } },
	pagination: { mode: 'none' },
	activeMapping: null,
	// v1 behaviour skips + records invalid rows per-row and finishes the run, so 'skip' is
	// the backward-compatible default; 'fail' is the new opt-in strict mode (abort the run).
	onRowError: 'skip',
	defaults: {},
	maxGroupsPerUser: null,
	maxRolesPerUser: null,
};

export class ApiContractValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApiContractValidationError';
	}
}

export function resolveApiContract(
	config: ApiContractConfig | null | undefined,
): ResolvedApiContract {
	if (!config) {
		return cloneDefault();
	}
	const base = cloneDefault();
	return {
		endpoints: { ...base.endpoints, ...stripUndefined(config.endpoints) },
		responseRoot: { ...base.responseRoot, ...stripUndefined(config.responseRoot) },
		userFieldMap: { ...base.userFieldMap, ...stripUndefined(config.userFieldMap) },
		groupFieldMap: { ...base.groupFieldMap, ...stripUndefined(config.groupFieldMap) },
		roleFieldMap: { ...base.roleFieldMap, ...stripUndefined(config.roleFieldMap) },
		passwordHashAlgorithmConstant:
			config.passwordHashAlgorithmConstant ?? base.passwordHashAlgorithmConstant,
		queryParams: config.queryParams ? { ...config.queryParams } : base.queryParams,
		headers: config.headers ? { ...config.headers } : base.headers,
		membershipSource: {
			groups: config.membershipSource?.groups ?? base.membershipSource.groups,
			roles: config.membershipSource?.roles ?? base.membershipSource.roles,
		},
		pagination: config.pagination ? { ...config.pagination } : base.pagination,
		activeMapping: config.activeMapping ?? base.activeMapping,
		onRowError: config.onRowError ?? base.onRowError,
		defaults: config.defaults ? { ...config.defaults } : base.defaults,
		maxGroupsPerUser: config.maxGroupsPerUser ?? base.maxGroupsPerUser,
		maxRolesPerUser: config.maxRolesPerUser ?? base.maxRolesPerUser,
	};
}

/**
 * Safe dot-path read: `getByPath({a:{b:1}}, 'a.b') === 1`. Returns undefined on any
 * miss, never throws, and ignores prototype keys (`__proto__`, `prototype`, `constructor`).
 */
export function getByPath(obj: unknown, path: string): unknown {
	if (!path) {
		return obj;
	}
	let current: unknown = obj;
	for (const key of path.split('.')) {
		if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
			return undefined;
		}
		if (current === null || typeof current !== 'object') {
			return undefined;
		}
		if (!Object.prototype.hasOwnProperty.call(current, key)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

const MAX_PATH_LENGTH = 512;
const MAX_DOTPATH_LENGTH = 128;
const MAX_DOTPATH_DEPTH = 8;
const DOTPATH_PATTERN = /^[A-Za-z0-9_.-]+$/;
const HTTP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertValidApiContractConfig(config: unknown): ApiContractConfig {
	if (config === null || config === undefined) {
		return {};
	}
	if (typeof config !== 'object' || Array.isArray(config)) {
		throw new ApiContractValidationError('apiContractConfig must be an object');
	}
	const c = config as Record<string, unknown>;

	if (c.endpoints !== undefined) {
		const e = requireObject(c.endpoints, 'endpoints');
		validatePath(e.usersPath, 'endpoints.usersPath', false);
		validatePath(e.userGroupsPath, 'endpoints.userGroupsPath', true);
		validatePath(e.userRolesPath, 'endpoints.userRolesPath', true);
	}
	if (c.responseRoot !== undefined) {
		const r = requireObject(c.responseRoot, 'responseRoot');
		for (const key of ['users', 'groups', 'roles']) {
			validateDotPath(r[key], `responseRoot.${key}`, true);
		}
	}
	validateFieldMap(c.userFieldMap, 'userFieldMap', [
		'id',
		'username',
		'email',
		'displayName',
		'passwordHash',
		'passwordHashAlgorithm',
		'active',
	]);
	validateFieldMap(c.groupFieldMap, 'groupFieldMap', ['id', 'name']);
	validateFieldMap(c.roleFieldMap, 'roleFieldMap', ['id', 'name']);

	if (
		c.passwordHashAlgorithmConstant !== undefined &&
		c.passwordHashAlgorithmConstant !== null &&
		(typeof c.passwordHashAlgorithmConstant !== 'string' ||
			c.passwordHashAlgorithmConstant.length > 64)
	) {
		throw new ApiContractValidationError('passwordHashAlgorithmConstant must be a short string');
	}

	validateStringMap(c.queryParams, 'queryParams', 20, 256);

	if (c.headers !== undefined) {
		const h = validateStringMap(c.headers, 'headers', 20, 256);
		for (const key of Object.keys(h)) {
			if (key.toLowerCase() === 'authorization') {
				throw new ApiContractValidationError('headers may not override Authorization');
			}
			if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
				throw new ApiContractValidationError(`Invalid header name "${key}"`);
			}
		}
	}

	if (c.membershipSource !== undefined) {
		const m = requireObject(c.membershipSource, 'membershipSource');
		for (const key of ['groups', 'roles']) {
			if (m[key] === undefined) {
				continue;
			}
			const entry = requireObject(m[key], `membershipSource.${key}`);
			if (entry.mode !== 'endpoint' && entry.mode !== 'embedded') {
				throw new ApiContractValidationError(
					`membershipSource.${key}.mode must be endpoint|embedded`,
				);
			}
			if (entry.mode === 'embedded') {
				if (entry.embeddedPath === undefined) {
					throw new ApiContractValidationError(
						`membershipSource.${key}.embeddedPath is required for embedded mode`,
					);
				}
				validateDotPath(entry.embeddedPath, `membershipSource.${key}.embeddedPath`, false);
			}
		}
	}

	if (c.pagination !== undefined) {
		validatePagination(c.pagination);
	}

	if (c.activeMapping !== undefined) {
		const a = requireObject(c.activeMapping, 'activeMapping');
		if (a.inverted !== undefined && typeof a.inverted !== 'boolean') {
			throw new ApiContractValidationError('activeMapping.inverted must be a boolean');
		}
		if (a.trueValues !== undefined) {
			if (!Array.isArray(a.trueValues) || a.trueValues.length > 50) {
				throw new ApiContractValidationError('activeMapping.trueValues must be an array (≤ 50)');
			}
			for (const v of a.trueValues) {
				if (typeof v !== 'string' || v.length === 0 || v.length > 64) {
					throw new ApiContractValidationError(
						'activeMapping.trueValues entries must be short strings',
					);
				}
			}
		}
	}

	if (c.onRowError !== undefined && c.onRowError !== 'fail' && c.onRowError !== 'skip') {
		throw new ApiContractValidationError('onRowError must be fail|skip');
	}

	if (c.defaults !== undefined) {
		const d = requireObject(c.defaults, 'defaults');
		if (d.displayNameFromUsername !== undefined && typeof d.displayNameFromUsername !== 'boolean') {
			throw new ApiContractValidationError('defaults.displayNameFromUsername must be a boolean');
		}
		if (d.email !== undefined && d.email !== null) {
			if (typeof d.email !== 'string' || !EMAIL_PATTERN.test(d.email)) {
				throw new ApiContractValidationError('defaults.email must be a valid email or null');
			}
		}
	}

	validateCap(c.maxGroupsPerUser, 'maxGroupsPerUser');
	validateCap(c.maxRolesPerUser, 'maxRolesPerUser');

	return config as ApiContractConfig;
}

/** Starter templates for the admin form (E9). Each is a valid ApiContractConfig. */
export const API_CONTRACT_PRESETS: ReadonlyArray<{
	id: string;
	label: string;
	config: ApiContractConfig;
}> = [
	{
		id: 'generic',
		label: 'Generic (v1 defaults)',
		config: {},
	},
	{
		id: 'keycloak-like',
		label: 'Keycloak-like',
		config: {
			endpoints: {
				usersPath: '/admin/realms/master/users',
				userGroupsPath: '/admin/realms/master/users/:id/groups',
				userRolesPath: '/admin/realms/master/users/:id/role-mappings/realm',
			},
			userFieldMap: {
				username: 'username',
				email: 'email',
				displayName: 'firstName',
				active: 'enabled',
			},
			groupFieldMap: { id: 'id', name: 'name' },
			roleFieldMap: { id: 'id', name: 'name' },
			pagination: {
				mode: 'offset',
				limitParam: 'max',
				offsetParam: 'first',
				pageSize: 100,
				maxPages: 50,
			},
		},
	},
	{
		id: 'auth0-like',
		label: 'Auth0-like',
		config: {
			endpoints: {
				usersPath: '/api/v2/users',
				userGroupsPath: '/api/v2/users/:id/groups',
				userRolesPath: '/api/v2/users/:id/roles',
			},
			userFieldMap: {
				id: 'user_id',
				username: 'username',
				email: 'email',
				displayName: 'name',
				active: 'blocked',
			},
			activeMapping: { trueValues: ['false'] },
			pagination: {
				mode: 'page',
				pageParam: 'page',
				limitParam: 'per_page',
				pageSize: 50,
				startPage: 0,
				maxPages: 50,
			},
		},
	},
];

// ---- internal helpers ----

function cloneDefault(): ResolvedApiContract {
	return {
		endpoints: { ...DEFAULT_API_CONTRACT.endpoints },
		responseRoot: { ...DEFAULT_API_CONTRACT.responseRoot },
		userFieldMap: { ...DEFAULT_API_CONTRACT.userFieldMap },
		groupFieldMap: { ...DEFAULT_API_CONTRACT.groupFieldMap },
		roleFieldMap: { ...DEFAULT_API_CONTRACT.roleFieldMap },
		passwordHashAlgorithmConstant: DEFAULT_API_CONTRACT.passwordHashAlgorithmConstant,
		queryParams: { ...DEFAULT_API_CONTRACT.queryParams },
		headers: { ...DEFAULT_API_CONTRACT.headers },
		membershipSource: {
			groups: { ...DEFAULT_API_CONTRACT.membershipSource.groups },
			roles: { ...DEFAULT_API_CONTRACT.membershipSource.roles },
		},
		pagination: { ...DEFAULT_API_CONTRACT.pagination },
		activeMapping: DEFAULT_API_CONTRACT.activeMapping,
		onRowError: DEFAULT_API_CONTRACT.onRowError,
		defaults: { ...DEFAULT_API_CONTRACT.defaults },
		maxGroupsPerUser: DEFAULT_API_CONTRACT.maxGroupsPerUser,
		maxRolesPerUser: DEFAULT_API_CONTRACT.maxRolesPerUser,
	};
}

function stripUndefined<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> {
	if (!obj) {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) {
			out[k] = v;
		}
	}
	return out as Partial<T>;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ApiContractValidationError(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function validatePath(value: unknown, field: string, requireIdPlaceholder: boolean): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
		throw new ApiContractValidationError(
			`${field} must be a non-empty path (≤ ${MAX_PATH_LENGTH} chars)`,
		);
	}
	if (!value.startsWith('/')) {
		throw new ApiContractValidationError(`${field} must start with "/"`);
	}
	if (value.startsWith('//')) {
		throw new ApiContractValidationError(`${field} must not be protocol-relative`);
	}
	if (value.includes('://') || value.includes('..') || /\s/.test(value)) {
		throw new ApiContractValidationError(
			`${field} must be a relative path without "..", whitespace, or scheme`,
		);
	}
	if (requireIdPlaceholder && !value.includes(':id')) {
		throw new ApiContractValidationError(`${field} must contain the ":id" placeholder`);
	}
}

function validateDotPath(value: unknown, field: string, allowEmpty: boolean): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'string') {
		throw new ApiContractValidationError(`${field} must be a string`);
	}
	if (value.length === 0) {
		if (allowEmpty) {
			return;
		}
		throw new ApiContractValidationError(`${field} must not be empty`);
	}
	if (value.length > MAX_DOTPATH_LENGTH) {
		throw new ApiContractValidationError(`${field} is too long`);
	}
	if (!DOTPATH_PATTERN.test(value)) {
		throw new ApiContractValidationError(`${field} contains illegal characters`);
	}
	if (value.split('.').length > MAX_DOTPATH_DEPTH) {
		throw new ApiContractValidationError(`${field} nesting too deep`);
	}
}

function validateFieldMap(value: unknown, field: string, keys: string[]): void {
	if (value === undefined) {
		return;
	}
	const map = requireObject(value, field);
	for (const [k, v] of Object.entries(map)) {
		if (!keys.includes(k)) {
			throw new ApiContractValidationError(`${field}.${k} is not a recognized field`);
		}
		validateDotPath(v, `${field}.${k}`, false);
	}
}

function validateStringMap(
	value: unknown,
	field: string,
	maxEntries: number,
	maxLen: number,
): Record<string, string> {
	if (value === undefined) {
		return {};
	}
	const map = requireObject(value, field);
	const entries = Object.entries(map);
	if (entries.length > maxEntries) {
		throw new ApiContractValidationError(`${field} has too many entries (max ${maxEntries})`);
	}
	for (const [k, v] of entries) {
		if (k.length === 0 || k.length > maxLen || typeof v !== 'string' || v.length > maxLen) {
			throw new ApiContractValidationError(`${field} keys/values must be ≤ ${maxLen} chars`);
		}
	}
	return map as Record<string, string>;
}

function validatePagination(value: unknown): void {
	const p = requireObject(value, 'pagination');
	if (p.mode !== 'none' && p.mode !== 'offset' && p.mode !== 'page') {
		throw new ApiContractValidationError('pagination.mode must be none|offset|page');
	}
	for (const key of ['limitParam', 'offsetParam', 'pageParam'] as const) {
		if (p[key] !== undefined) {
			if (
				typeof p[key] !== 'string' ||
				(p[key] as string).length === 0 ||
				(p[key] as string).length > 256
			) {
				throw new ApiContractValidationError(`pagination.${key} must be a short non-empty string`);
			}
		}
	}
	if (
		p.pageSize !== undefined &&
		(!Number.isInteger(p.pageSize) || (p.pageSize as number) < 1 || (p.pageSize as number) > 1000)
	) {
		throw new ApiContractValidationError('pagination.pageSize must be 1..1000');
	}
	if (
		p.maxPages !== undefined &&
		(!Number.isInteger(p.maxPages) || (p.maxPages as number) < 1 || (p.maxPages as number) > 1000)
	) {
		throw new ApiContractValidationError('pagination.maxPages must be 1..1000');
	}
	if (
		p.startPage !== undefined &&
		(!Number.isInteger(p.startPage) || (p.startPage as number) < 0)
	) {
		throw new ApiContractValidationError('pagination.startPage must be a non-negative integer');
	}
	if (p.mode === 'offset' && p.offsetParam === undefined) {
		throw new ApiContractValidationError('pagination.offsetParam is required for offset mode');
	}
	if (p.mode === 'page' && p.pageParam === undefined) {
		throw new ApiContractValidationError('pagination.pageParam is required for page mode');
	}
}

function validateCap(value: unknown, field: string): void {
	if (value === undefined) {
		return;
	}
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10000) {
		throw new ApiContractValidationError(`${field} must be 1..10000`);
	}
}
