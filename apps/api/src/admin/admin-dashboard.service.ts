import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminDashboardResponseDto } from '@nestidp/shared';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONNECTIONS_API_PATH,
	IDENTITY_ROUTE_PREFIX,
	SAML_METADATA_PATH,
	SAML_SSO_PATH,
	SP_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
} from '@nestidp/shared';
import { toApiConnectionDto } from '../api-connections/api-connections.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { AdminStatsService } from './admin-stats.service';

@Injectable()
export class AdminDashboardService {
	constructor(
		private readonly adminStatsService: AdminStatsService,
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	async getDashboard(): Promise<AdminDashboardResponseDto> {
		const counts = await this.adminStatsService.getCounts();
		const base = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const connectionRow = await this.prisma.apiConnection.findFirst({
			orderBy: { createdAt: 'asc' },
		});

		const entityId = settings?.entityId ?? base;

		return {
			counts,
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
			identityUsersRoute: `${IDENTITY_ROUTE_PREFIX}/users`,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `${base}${SAML_METADATA_PATH}`,
			entityId,
			ssoUrl: `${base}${SAML_SSO_PATH}`,
			apiConnection: connectionRow ? toApiConnectionDto(connectionRow) : null,
			lastSyncStatus: connectionRow?.lastSyncStatus ?? null,
			lastSyncAt: connectionRow?.lastSyncAt?.toISOString() ?? null,
		};
	}
}
