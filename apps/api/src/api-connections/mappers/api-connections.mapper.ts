import { ApiConnection } from '@prisma/client';
import type {
	ApiConnectionDto,
	ApiContractConfig,
	OAuthClientAuthMethod,
	ProxyCheckStatus,
} from '@nestidp/shared';
import { isProxyCheckStatus } from '@nestidp/shared';

export function toApiConnectionDto(
	row: ApiConnection,
	extra?: { oauthLastTokenAt?: string | null },
): ApiConnectionDto {
	return {
		id: row.id,
		name: row.name,
		baseUrl: row.baseUrl,
		authType: row.authType,
		hasBearerToken: row.authCredentialsEncrypted.length > 0,
		apiContractConfig: (row.apiContractConfig ?? null) as ApiContractConfig | null,
		oauthTokenUrl: row.oauthTokenUrl ?? null,
		oauthClientId: row.oauthClientId ?? null,
		oauthScope: row.oauthScope ?? null,
		oauthAudience: row.oauthAudience ?? null,
		oauthClientAuthMethod: (row.oauthClientAuthMethod as OAuthClientAuthMethod | null) ?? null,
		oauthTokenRequestParams: (row.oauthTokenRequestParams ?? null) as Record<string, string> | null,
		hasOauthClientSecret: (row.oauthClientSecretEncrypted ?? '').length > 0,
		oauthLastTokenAt: extra?.oauthLastTokenAt ?? null,
		proxyEnabled: row.proxyEnabled,
		proxyUrl: row.proxyUrl ?? null,
		proxyUsername: row.proxyUsername ?? null,
		hasProxyPassword: (row.proxyPasswordEncrypted ?? '').length > 0,
		noProxyHosts: row.noProxyHosts ?? null,
		lastProxyCheckStatus:
			row.lastProxyCheckStatus && isProxyCheckStatus(row.lastProxyCheckStatus)
				? (row.lastProxyCheckStatus as ProxyCheckStatus)
				: null,
		lastProxyCheckAt: row.lastProxyCheckAt?.toISOString() ?? null,
		lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
		lastSyncStatus: row.lastSyncStatus,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
