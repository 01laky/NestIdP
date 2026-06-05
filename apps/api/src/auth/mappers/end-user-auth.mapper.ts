import type { EndUserPublicDto } from '@nestidp/shared';
import type { UserProfileForAuth } from '../../identity/identity.repository';

export function toEndUserPublicDto(profile: UserProfileForAuth): EndUserPublicDto {
	return {
		id: profile.id,
		username: profile.username,
		email: profile.email,
		displayName: profile.displayName,
		groups: [...profile.groups].sort((a, b) => a.localeCompare(b)),
		roles: [...profile.roles].sort((a, b) => a.localeCompare(b)),
	};
}
