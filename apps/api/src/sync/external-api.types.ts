export interface ExternalUserDto {
	id: string;
	username: string;
	email?: string | null;
	displayName?: string | null;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
}

export interface ExternalGroupDto {
	id: string;
	name: string;
}

export interface ExternalRoleDto {
	id: string;
	name: string;
}
