import { toEndUserPublicDto } from './end-user-auth.mapper';
import type { UserProfileForAuth } from '../identity/identity.repository';

describe('toEndUserPublicDto', () => {
	const profile: UserProfileForAuth = {
		id: 'user-1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice',
		active: true,
		groups: ['Zeta', 'Alpha'],
		roles: ['Viewer', 'Admin'],
	};

	it('API-AUTH-MAP-01: maps profile fields to EndUserPublicDto', () => {
		expect(toEndUserPublicDto(profile)).toEqual({
			id: 'user-1',
			username: 'alice',
			email: 'alice@example.com',
			displayName: 'Alice',
			groups: ['Alpha', 'Zeta'],
			roles: ['Admin', 'Viewer'],
		});
	});

	it('API-AUTH-MAP-02: sorts groups and roles alphabetically', () => {
		const dto = toEndUserPublicDto({
			...profile,
			groups: ['b', 'a', 'c'],
			roles: ['z', 'm'],
		});
		expect(dto.groups).toEqual(['a', 'b', 'c']);
		expect(dto.roles).toEqual(['m', 'z']);
	});

	it('API-AUTH-MAP-03: allows null email and displayName', () => {
		const dto = toEndUserPublicDto({
			...profile,
			email: null,
			displayName: null,
		});
		expect(dto.email).toBeNull();
		expect(dto.displayName).toBeNull();
	});

	it('API-AUTH-MAP-04: never exposes password or connection fields', () => {
		const dto = toEndUserPublicDto(profile);
		expect(dto).not.toHaveProperty('passwordHash');
		expect(dto).not.toHaveProperty('apiConnectionId');
		expect(dto).not.toHaveProperty('active');
	});
});
