import { resolveApiContract } from '@nestidp/shared';
import {
	detectDuplicateUserIds,
	ExternalApiValidationError,
	mapExternalGroupRow,
	mapExternalRoleRow,
	mapExternalUserRow,
	parseExternalUsersJson,
} from '@api/sync/validators/external-api.validator';

const HASH = '$2b$12$abcdefghijklmnopqrstuv';

describe('external-api mapping (configurable contract)', () => {
	it('API-MAP-01: flat field map (login→username, pwd_hash→passwordHash)', () => {
		const contract = resolveApiContract({
			userFieldMap: {
				id: 'uid',
				username: 'login',
				passwordHash: 'pwd_hash',
				passwordHashAlgorithm: 'algo',
				active: 'enabled',
			},
		});
		const user = mapExternalUserRow(
			{ uid: 'u1', login: 'alice', pwd_hash: HASH, algo: 'bcrypt', enabled: true },
			{ fieldMap: contract.userFieldMap },
		);
		expect(user).toMatchObject({ id: 'u1', username: 'alice', passwordHash: HASH, active: true });
	});

	it('API-MAP-02: nested dot-path map (profile.email, credentials.hash)', () => {
		const contract = resolveApiContract({
			userFieldMap: { email: 'profile.email', passwordHash: 'credentials.hash' },
		});
		const user = mapExternalUserRow(
			{
				id: 'u1',
				username: 'bob',
				profile: { email: 'bob@example.com' },
				credentials: { hash: HASH },
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
			{ fieldMap: contract.userFieldMap },
		);
		expect(user.email).toBe('bob@example.com');
		expect(user.passwordHash).toBe(HASH);
	});

	it('API-MAP-03: passwordHashAlgorithmConstant used when API omits the field', () => {
		const user = mapExternalUserRow(
			{ id: 'u1', username: 'c', passwordHash: HASH, active: true },
			{ passwordHashAlgorithmConstant: 'bcrypt' },
		);
		expect(user.passwordHashAlgorithm).toBe('bcrypt');
	});

	it('API-MAP-04: active coercion (boolean, strings, numbers); junk throws', () => {
		const mk = (active: unknown) =>
			mapExternalUserRow({
				id: 'u',
				username: 'u',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active,
			}).active;
		expect(mk(true)).toBe(true);
		expect(mk('true')).toBe(true);
		expect(mk('FALSE')).toBe(false);
		expect(mk(1)).toBe(true);
		expect(mk(0)).toBe(false);
		expect(() => mk('sometimes')).toThrow(ExternalApiValidationError);
	});

	it('API-CONTRACT-E4-01: activeMapping trueValues (case-insensitive) + inverted', () => {
		const base = { id: 'u', username: 'u', passwordHash: HASH, passwordHashAlgorithm: 'bcrypt' };
		expect(
			mapExternalUserRow(
				{ ...base, status: 'Active' },
				{
					fieldMap: resolveApiContract({ userFieldMap: { active: 'status' } }).userFieldMap,
					activeMapping: { trueValues: ['active', 'enabled'] },
				},
			).active,
		).toBe(true);
		expect(
			mapExternalUserRow(
				{ ...base, status: 'suspended' },
				{
					fieldMap: resolveApiContract({ userFieldMap: { active: 'status' } }).userFieldMap,
					activeMapping: { trueValues: ['active'] },
				},
			).active,
		).toBe(false);
		// inverted: blocked=true → active=false
		expect(
			mapExternalUserRow(
				{ ...base, blocked: true },
				{
					fieldMap: resolveApiContract({ userFieldMap: { active: 'blocked' } }).userFieldMap,
					activeMapping: { inverted: true },
				},
			).active,
		).toBe(false);
	});

	it('API-MAP-05: mapping error names canonical field + source path', () => {
		expect(() =>
			mapExternalUserRow(
				{ id: 'u1', profile: {} },
				{
					fieldMap: resolveApiContract({ userFieldMap: { username: 'profile.login' } })
						.userFieldMap,
				},
			),
		).toThrow(/username \(mapped from "profile.login"\)/);
	});

	it('API-MAP-06: bcrypt/email validation still enforced after mapping', () => {
		expect(() =>
			mapExternalUserRow({
				id: 'u',
				username: 'u',
				passwordHash: 'plaintext',
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			}),
		).toThrow(/bcrypt/);
		expect(() =>
			mapExternalUserRow({
				id: 'u',
				username: 'u',
				email: 'not-email',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			}),
		).toThrow(/email/);
	});

	it('API-CONTRACT-E7-01: defaults.displayNameFromUsername + defaults.email', () => {
		const user = mapExternalUserRow(
			{
				id: 'u1',
				username: 'dave',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
			{ defaults: { displayNameFromUsername: true, email: 'fallback@example.com' } },
		);
		expect(user.displayName).toBe('dave');
		expect(user.email).toBe('fallback@example.com');
	});

	it('API-MAP-08: group/role field maps applied', () => {
		const g = mapExternalGroupRow(
			{ groupId: 'g1', groupName: 'Eng' },
			{ id: 'groupId', name: 'groupName' },
		);
		expect(g).toEqual({ id: 'g1', name: 'Eng' });
		const r = mapExternalRoleRow(
			{ roleId: 'r1', roleName: 'Admin' },
			{ id: 'roleId', name: 'roleName' },
		);
		expect(r).toEqual({ id: 'r1', name: 'Admin' });
	});

	it('rejects unsupported passwordHashAlgorithm even via constant', () => {
		expect(() =>
			mapExternalUserRow(
				{ id: 'u', username: 'u', passwordHash: HASH, active: true },
				{
					passwordHashAlgorithmConstant: 'md5',
				},
			),
		).toThrow(/Unsupported passwordHashAlgorithm/);
	});

	it('EDGE: oversize id/username/displayName rejected after mapping', () => {
		const base = { passwordHash: HASH, passwordHashAlgorithm: 'bcrypt', active: true };
		expect(() => mapExternalUserRow({ ...base, id: 'x'.repeat(300), username: 'u' })).toThrow(/id/);
		expect(() => mapExternalUserRow({ ...base, id: 'u', username: 'x'.repeat(200) })).toThrow(
			/username/,
		);
		expect(() =>
			mapExternalUserRow({ ...base, id: 'u', username: 'u', displayName: 'x'.repeat(300) }),
		).toThrow(/displayName/);
	});

	it('EDGE: email is normalized (lowercased/trimmed); null when missing + no default', () => {
		const u = mapExternalUserRow({
			id: 'u',
			username: 'u',
			email: '  Alice@Example.COM ',
			passwordHash: HASH,
			passwordHashAlgorithm: 'bcrypt',
			active: true,
		});
		expect(u.email).toBe('alice@example.com');
		const u2 = mapExternalUserRow({
			id: 'u',
			username: 'u',
			passwordHash: HASH,
			passwordHashAlgorithm: 'bcrypt',
			active: true,
		});
		expect(u2.email).toBeNull();
	});

	it('EDGE: activeMapping with empty trueValues falls back to standard coercion', () => {
		const u = mapExternalUserRow(
			{
				id: 'u',
				username: 'u',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: 'true',
			},
			{ activeMapping: { trueValues: [] } },
		);
		expect(u.active).toBe(true);
	});

	it('EDGE: passwordHashAlgorithmConstant overrides a present algorithm field', () => {
		const u = mapExternalUserRow(
			{
				id: 'u',
				username: 'u',
				passwordHash: HASH,
				passwordHashAlgorithm: 'argon2id',
				active: true,
			},
			{ passwordHashAlgorithmConstant: 'bcrypt' },
		);
		expect(u.passwordHashAlgorithm).toBe('bcrypt');
	});

	it('EDGE: defaults.email only used when source missing (present source wins)', () => {
		const u = mapExternalUserRow(
			{
				id: 'u',
				username: 'u',
				email: 'real@example.com',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
			{ defaults: { email: 'fallback@example.com' } },
		);
		expect(u.email).toBe('real@example.com');
	});

	it('API-MAP-07: parseExternalUsersJson dedupes by id (last wins)', () => {
		const users = parseExternalUsersJson([
			{
				id: 'u1',
				username: 'first',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
			{
				id: 'u1',
				username: 'second',
				passwordHash: HASH,
				passwordHashAlgorithm: 'bcrypt',
				active: true,
			},
		]);
		expect(users).toHaveLength(1);
		expect(users[0].username).toBe('second');
	});

	it('EDGE: detectDuplicateUserIds reads a nested id path', () => {
		const body = [{ profile: { uid: 'a' } }, { profile: { uid: 'a' } }];
		expect(detectDuplicateUserIds(body, 'profile.uid')).toBe(true);
		expect(
			detectDuplicateUserIds([{ profile: { uid: 'a' } }, { profile: { uid: 'b' } }], 'profile.uid'),
		).toBe(false);
	});

	it('API-MAP-09: group/role mapping error names canonical field + source path', () => {
		expect(() => mapExternalGroupRow({ gid: 'g1' }, { id: 'gid', name: 'gname' })).toThrow(
			/name \(mapped from "gname"\)/,
		);
	});
});
