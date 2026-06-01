import type { Request } from 'express';
import type { AdminMeDto } from '@nestidp/shared';

export interface AuthenticatedAdmin {
	id: string;
	username: string;
}

export type AdminAuthenticatedRequest = Request & {
	adminUser?: AuthenticatedAdmin;
};

export function toAdminMeDto(admin: AuthenticatedAdmin): AdminMeDto {
	return { id: admin.id, username: admin.username };
}
