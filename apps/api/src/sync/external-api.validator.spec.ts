import {
	ExternalApiValidationError,
	assertUsersArrayWithinLimit,
	normalizeSyncedEmail,
	parseExternalGroupsJson,
	parseExternalRolesJson,
	parseExternalUsersJson,
} from './external-api.validator';

const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';

function validUser(overrides: Record<string, unknown> = {}) {
	return {
		id: 'user-1',
		username: 'alice',
		passwordHash: TEST_PASSWORD_HASH,
		passwordHashAlgorithm: 'bcrypt',
		active: true,
		...overrides,
	};
}

describe('external-api.validator', () => {
	it('API-SYNC-VAL-01: Valid users array parses', () => {
		const users = parseExternalUsersJson([
			validUser({ id: 'u1', username: 'alice', email: 'Alice@Example.com' }),
			validUser({ id: 'u2', username: 'bob', active: false }),
		]);
		expect(users).toHaveLength(2);
		expect(users[0]).toMatchObject({
			id: 'u1',
			username: 'alice',
			email: 'alice@example.com',
			passwordHash: TEST_PASSWORD_HASH,
			passwordHashAlgorithm: 'bcrypt',
			active: true,
		});
		expect(users[1].active).toBe(false);
	});

	it('API-SYNC-VAL-02: Non-array top-level → throws', () => {
		expect(() => parseExternalUsersJson('not-array')).toThrow(ExternalApiValidationError);
		expect(() => parseExternalUsersJson('not-array')).toThrow(
			/Users response must be a JSON array/,
		);
	});

	it('API-SYNC-VAL-03: Missing username → throws', () => {
		expect(() => parseExternalUsersJson([validUser({ username: undefined })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ username: undefined })])).toThrow(
			/Missing or invalid username/,
		);
	});

	it('API-SYNC-VAL-04: Empty passwordHash → throws', () => {
		expect(() => parseExternalUsersJson([validUser({ passwordHash: '   ' })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ passwordHash: '   ' })])).toThrow(
			/Invalid passwordHash/,
		);
	});

	it('API-SYNC-VAL-05: passwordHashAlgorithm: argon2 → throws', () => {
		expect(() => parseExternalUsersJson([validUser({ passwordHashAlgorithm: 'argon2' })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ passwordHashAlgorithm: 'argon2' })])).toThrow(
			/Unsupported passwordHashAlgorithm/,
		);
	});

	it('API-SYNC-VAL-06: active: "true" string → throws', () => {
		expect(() => parseExternalUsersJson([validUser({ active: 'true' })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ active: 'true' })])).toThrow(
			/active must be a boolean/,
		);
	});

	it('API-SYNC-VAL-07: Valid groups array parses', () => {
		const groups = parseExternalGroupsJson([
			{ id: 'g1', name: 'Engineering' },
			{ id: 'g2', name: '  Sales  ' },
		]);
		expect(groups).toEqual([
			{ id: 'g1', name: 'Engineering' },
			{ id: 'g2', name: 'Sales' },
		]);
	});

	it('API-SYNC-VAL-08: Valid roles array parses', () => {
		const roles = parseExternalRolesJson([{ id: 'r1', name: 'Admin' }]);
		expect(roles).toEqual([{ id: 'r1', name: 'Admin' }]);
	});

	it('API-SYNC-VAL-09: Wrapper object { data: [] } → throws', () => {
		expect(() => parseExternalUsersJson({ data: [] })).toThrow(ExternalApiValidationError);
		expect(() => parseExternalGroupsJson({ data: [] })).toThrow(ExternalApiValidationError);
	});

	it('API-SYNC-VAL-10: Trim external ids / usernames', () => {
		const users = parseExternalUsersJson([validUser({ id: '  user-1  ', username: '  alice  ' })]);
		expect(users[0].id).toBe('user-1');
		expect(users[0].username).toBe('alice');
	});

	it('API-SYNC-VAL-11: Non-bcrypt passwordHash prefix rejected', () => {
		expect(() => parseExternalUsersJson([validUser({ passwordHash: 'sha256:deadbeef' })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ passwordHash: 'sha256:deadbeef' })])).toThrow(
			/passwordHash must be a bcrypt hash/,
		);
	});

	it('API-SYNC-VAL-12: Duplicate user id in array — last wins', () => {
		const users = parseExternalUsersJson([
			validUser({ id: 'dup', username: 'first' }),
			validUser({ id: 'dup', username: 'second' }),
		]);
		expect(users).toHaveLength(1);
		expect(users[0].username).toBe('second');
	});

	it('API-SYNC-VAL-13: Email normalized to lowercase + trimmed', () => {
		const users = parseExternalUsersJson([validUser({ email: '  Alice@Example.COM  ' })]);
		expect(users[0].email).toBe('alice@example.com');
	});

	it('API-SYNC-VAL-14: Array length > SYNC_MAX_USERS_PER_RUN → throws', () => {
		const body = Array.from({ length: 3 }, (_, i) => validUser({ id: `u${i}` }));
		expect(() => parseExternalUsersJson(body, { maxUsers: 2 })).toThrow(ExternalApiValidationError);
		expect(() => parseExternalUsersJson(body, { maxUsers: 2 })).toThrow(
			/User count exceeds limit of 2/,
		);
		expect(() => assertUsersArrayWithinLimit(body, 2)).toThrow(/User count exceeds limit of 2/);
	});

	it('API-SYNC-VAL-15: normalizeSyncedEmail returns null for blank', () => {
		expect(normalizeSyncedEmail(null)).toBeNull();
		expect(normalizeSyncedEmail(undefined)).toBeNull();
		expect(normalizeSyncedEmail('')).toBeNull();
		expect(normalizeSyncedEmail('   ')).toBeNull();
	});

	it('API-SYNC-VAL-16: Invalid group row missing name → throws', () => {
		expect(() => parseExternalGroupsJson([{ id: 'g1' }])).toThrow(ExternalApiValidationError);
		expect(() => parseExternalGroupsJson([{ id: 'g1' }])).toThrow(/Missing or invalid name/);
	});

	it('API-SYNC-VAL-17: Invalid role row missing id → throws', () => {
		expect(() => parseExternalRolesJson([{ name: 'Admin' }])).toThrow(ExternalApiValidationError);
	});

	it('API-SYNC-VAL-18: $2a$ and $2y$ bcrypt prefixes accepted', () => {
		const usersA = parseExternalUsersJson([
			validUser({ passwordHash: '$2a$12$abcdefghijklmnopqrstuv' }),
		]);
		expect(usersA).toHaveLength(1);
		const usersY = parseExternalUsersJson([
			validUser({ passwordHash: '$2y$12$abcdefghijklmnopqrstuv' }),
		]);
		expect(usersY).toHaveLength(1);
	});

	it('API-SYNC-VAL-19: Invalid email without @ → throws', () => {
		expect(() => parseExternalUsersJson([validUser({ email: 'not-an-email' })])).toThrow(
			ExternalApiValidationError,
		);
		expect(() => parseExternalUsersJson([validUser({ email: 'not-an-email' })])).toThrow(
			/Invalid email/,
		);
	});

	it('API-SYNC-VAL-20: Empty group name after trim → throws', () => {
		expect(() => parseExternalGroupsJson([{ id: 'g1', name: '   ' }])).toThrow(
			ExternalApiValidationError,
		);
	});

	it('API-SYNC-VAL-21: Duplicate group ids in array are all returned (deduped at upsert)', () => {
		const groups = parseExternalGroupsJson([
			{ id: 'dup', name: 'first' },
			{ id: 'dup', name: 'second' },
		]);
		expect(groups).toHaveLength(2);
		expect(groups.map((g) => g.name)).toEqual(['first', 'second']);
	});

	it('API-SYNC-VAL-22: Oversized external id rejected', () => {
		const longId = 'x'.repeat(257);
		expect(() => parseExternalUsersJson([validUser({ id: longId })])).toThrow(
			ExternalApiValidationError,
		);
	});
});
