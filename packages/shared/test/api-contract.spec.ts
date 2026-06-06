import { describe, expect, it } from 'vitest';
import {
	API_CONTRACT_PRESETS,
	ApiContractValidationError,
	DEFAULT_API_CONTRACT,
	assertValidApiContractConfig,
	getByPath,
	resolveApiContract,
} from '../src/index.js';

describe('api-contract', () => {
	it('SH-CONTRACT-01: resolveApiContract(null) returns the v1 defaults', () => {
		const resolved = resolveApiContract(null);
		expect(resolved.endpoints).toEqual(DEFAULT_API_CONTRACT.endpoints);
		expect(resolved.userFieldMap.username).toBe('username');
		expect(resolved.onRowError).toBe('skip');
		expect(resolved.pagination.mode).toBe('none');
	});

	it('SH-CONTRACT-02: partial config deep-merges over defaults', () => {
		const resolved = resolveApiContract({
			endpoints: { usersPath: '/v1/accounts' },
			userFieldMap: { username: 'login' },
		});
		expect(resolved.endpoints.usersPath).toBe('/v1/accounts');
		expect(resolved.endpoints.userGroupsPath).toBe('/users/:id/groups'); // untouched default
		expect(resolved.userFieldMap.username).toBe('login');
		expect(resolved.userFieldMap.email).toBe('email'); // untouched default
	});

	it('SH-CONTRACT-03: getByPath reads nested paths, misses, and ignores prototype keys', () => {
		expect(getByPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
		expect(getByPath({ a: 1 }, 'a.b')).toBeUndefined();
		expect(getByPath({}, '__proto__.polluted')).toBeUndefined();
		expect(getByPath({ a: { __proto__: { x: 1 } } }, 'a.__proto__.x')).toBeUndefined();
		expect(getByPath(null, 'a')).toBeUndefined();
		expect(getByPath({ a: 1 }, '')).toEqual({ a: 1 });
	});

	it('SH-CONTRACT-04: rejects absolute / protocol-relative / traversal / oversize paths', () => {
		expect(() =>
			assertValidApiContractConfig({ endpoints: { usersPath: 'https://evil/users' } }),
		).toThrow(ApiContractValidationError);
		expect(() =>
			assertValidApiContractConfig({ endpoints: { usersPath: '//evil/users' } }),
		).toThrow();
		expect(() => assertValidApiContractConfig({ endpoints: { usersPath: '/a/../b' } })).toThrow();
		expect(() => assertValidApiContractConfig({ endpoints: { usersPath: 'users' } })).toThrow();
		expect(() =>
			assertValidApiContractConfig({ endpoints: { usersPath: `/${'x'.repeat(600)}` } }),
		).toThrow();
	});

	it('SH-CONTRACT-05: rejects group/role path without :id placeholder', () => {
		expect(() =>
			assertValidApiContractConfig({ endpoints: { userGroupsPath: '/users/groups' } }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ endpoints: { userRolesPath: '/users/roles' } }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ endpoints: { userGroupsPath: '/g/:id/x' } }),
		).not.toThrow();
	});

	it('SH-CONTRACT-06: rejects illegal/oversize/empty field-map values', () => {
		expect(() => assertValidApiContractConfig({ userFieldMap: { username: 'a b' } })).toThrow();
		expect(() => assertValidApiContractConfig({ userFieldMap: { username: '' } })).toThrow();
		expect(() =>
			assertValidApiContractConfig({ userFieldMap: { unknownField: 'x' } as never }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ userFieldMap: { username: 'profile.login' } }),
		).not.toThrow();
	});

	it('SH-CONTRACT-07: rejects oversize queryParams + over-deep dot-paths', () => {
		const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
		expect(() => assertValidApiContractConfig({ queryParams: tooMany })).toThrow();
		expect(() =>
			assertValidApiContractConfig({ responseRoot: { users: 'a.b.c.d.e.f.g.h.i' } }),
		).toThrow();
	});

	it('rejects headers overriding Authorization + invalid header names', () => {
		expect(() => assertValidApiContractConfig({ headers: { Authorization: 'x' } })).toThrow();
		expect(() => assertValidApiContractConfig({ headers: { 'bad header': 'x' } })).toThrow();
		expect(() => assertValidApiContractConfig({ headers: { 'X-Api-Version': '2' } })).not.toThrow();
	});

	it('validates pagination, activeMapping, onRowError, defaults, caps', () => {
		expect(() => assertValidApiContractConfig({ pagination: { mode: 'offset' } })).toThrow(); // missing offsetParam
		expect(() =>
			assertValidApiContractConfig({
				pagination: { mode: 'offset', offsetParam: 'o', pageSize: 50 },
			}),
		).not.toThrow();
		expect(() =>
			assertValidApiContractConfig({
				pagination: { mode: 'page', pageParam: 'p', pageSize: 2000 },
			}),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ activeMapping: { trueValues: [123] as never } }),
		).toThrow();
		expect(() => assertValidApiContractConfig({ onRowError: 'nope' as never })).toThrow();
		expect(() => assertValidApiContractConfig({ defaults: { email: 'not-an-email' } })).toThrow();
		expect(() => assertValidApiContractConfig({ maxGroupsPerUser: 0 })).toThrow();
		expect(() => assertValidApiContractConfig({ maxGroupsPerUser: 500 })).not.toThrow();
	});

	it('SH-CONTRACT-03b: getByPath traverses array indices, length, and empty segments; blocks proto', () => {
		expect(getByPath([{ x: 1 }], '0.x')).toBe(1);
		expect(getByPath({ a: ['z'] }, 'a.0')).toBe('z');
		expect(getByPath([1, 2, 3], 'length')).toBe(3);
		expect(getByPath({ a: { '': { b: 2 } } }, 'a..b')).toBe(2);
		expect(getByPath({ a: null }, 'a.b')).toBeUndefined();
		expect(getByPath(5, 'a')).toBeUndefined();
		expect(getByPath({}, 'constructor')).toBeUndefined();
		expect(getByPath({}, 'a.prototype.x')).toBeUndefined();
	});

	it('SH-CONTRACT-02b: resolve clones (no shared mutation) and replaces queryParams', () => {
		const a = resolveApiContract(null);
		const b = resolveApiContract(null);
		a.endpoints.usersPath = '/mutated';
		a.queryParams.injected = '1';
		expect(b.endpoints.usersPath).toBe('/users'); // not affected
		expect(DEFAULT_API_CONTRACT.endpoints.usersPath).toBe('/users'); // default intact
		expect(DEFAULT_API_CONTRACT.queryParams).toEqual({});
		// queryParams replace semantics (not merge)
		expect(resolveApiContract({ queryParams: { only: 'this' } }).queryParams).toEqual({
			only: 'this',
		});
	});

	it('SH-CONTRACT-02c: undefined values in a partial do not override defaults', () => {
		const resolved = resolveApiContract({ endpoints: { usersPath: undefined } });
		expect(resolved.endpoints.usersPath).toBe('/users');
	});

	it('SH-CONTRACT-04b: config must be an object; sub-objects validated', () => {
		expect(() => assertValidApiContractConfig('nope' as never)).toThrow(ApiContractValidationError);
		expect(() => assertValidApiContractConfig([] as never)).toThrow();
		expect(() => assertValidApiContractConfig({ endpoints: 'x' as never })).toThrow();
		expect(() => assertValidApiContractConfig({ headers: { 'X-Ok': 5 as never } })).toThrow();
		expect(() =>
			assertValidApiContractConfig({ passwordHashAlgorithmConstant: 'x'.repeat(65) }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ passwordHashAlgorithmConstant: null }),
		).not.toThrow();
		expect(() => assertValidApiContractConfig(null)).not.toThrow();
		expect(() => assertValidApiContractConfig(undefined)).not.toThrow();
	});

	it('SH-CONTRACT-07b: pagination boundaries + membershipSource + dot-path depth edges', () => {
		// pageSize/maxPages bounds
		expect(() =>
			assertValidApiContractConfig({ pagination: { mode: 'page', pageParam: 'p', pageSize: 0 } }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ pagination: { mode: 'page', pageParam: 'p', pageSize: 1 } }),
		).not.toThrow();
		expect(() =>
			assertValidApiContractConfig({
				pagination: { mode: 'page', pageParam: 'p', maxPages: 1001 },
			}),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ pagination: { mode: 'page', pageParam: 'p', startPage: -1 } }),
		).toThrow();
		expect(() => assertValidApiContractConfig({ pagination: { mode: 'none' } })).not.toThrow();
		// membershipSource
		expect(() =>
			assertValidApiContractConfig({ membershipSource: { groups: { mode: 'embedded' } } as never }),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({
				membershipSource: { groups: { mode: 'embedded', embeddedPath: 'groups' } },
			}),
		).not.toThrow();
		expect(() =>
			assertValidApiContractConfig({ membershipSource: { roles: { mode: 'sideways' } } as never }),
		).toThrow();
		// dot-path depth: 8 ok, 9 fail
		expect(() =>
			assertValidApiContractConfig({ responseRoot: { users: 'a.b.c.d.e.f.g.h' } }),
		).not.toThrow();
		expect(() =>
			assertValidApiContractConfig({ responseRoot: { users: 'a.b.c.d.e.f.g.h.i' } }),
		).toThrow();
		// activeMapping trueValues size
		expect(() =>
			assertValidApiContractConfig({
				activeMapping: { trueValues: Array.from({ length: 51 }, () => 'x') },
			}),
		).toThrow();
		expect(() =>
			assertValidApiContractConfig({ activeMapping: { inverted: 'yes' as never } }),
		).toThrow();
		// defaults.email null allowed
		expect(() => assertValidApiContractConfig({ defaults: { email: null } })).not.toThrow();
		expect(() =>
			assertValidApiContractConfig({ defaults: { displayNameFromUsername: 'x' as never } }),
		).toThrow();
		// caps upper bound
		expect(() => assertValidApiContractConfig({ maxRolesPerUser: 10001 })).toThrow();
	});

	it('SH-CONTRACT-E9-01: every preset is a valid contract config', () => {
		expect(API_CONTRACT_PRESETS.length).toBeGreaterThanOrEqual(3);
		for (const preset of API_CONTRACT_PRESETS) {
			expect(() => assertValidApiContractConfig(preset.config)).not.toThrow();
			// presets resolve cleanly
			expect(() => resolveApiContract(preset.config)).not.toThrow();
		}
	});
});
