import type { AdminUser } from '@prisma/client';
import type { AdminUserPublicDto } from '@nestidp/shared';

export function toAdminUserPublicDto(row: AdminUser): AdminUserPublicDto {
	return {
		id: row.id,
		username: row.username,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
