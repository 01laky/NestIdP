import { ApiConnection } from '@prisma/client';
import type { ApiConnectionDto, ApiContractConfig } from '@nestidp/shared';

export function toApiConnectionDto(row: ApiConnection): ApiConnectionDto {
	return {
		id: row.id,
		name: row.name,
		baseUrl: row.baseUrl,
		authType: row.authType,
		hasBearerToken: row.authCredentialsEncrypted.length > 0,
		apiContractConfig: (row.apiContractConfig ?? null) as ApiContractConfig | null,
		lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
		lastSyncStatus: row.lastSyncStatus,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
