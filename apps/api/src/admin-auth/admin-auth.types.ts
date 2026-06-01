import type { Request } from 'express';
import type { AdminMeDto } from '@nestidp/shared';
import type { AdminSessionPayload } from './admin-session.service';

export interface AuthenticatedAdmin {
	id: string;
	username: string;
}

export type AdminAuthenticatedRequest = Request & {
	adminUser?: AuthenticatedAdmin;
	adminSession?: AdminSessionPayload;
};

export function toAdminMeDto(admin: AuthenticatedAdmin): AdminMeDto {
	return { id: admin.id, username: admin.username };
}
