import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminDashboardResponseDto } from '@nestidp/shared';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONNECTIONS_API_PATH,
	IDENTITY_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	ADMIN_USERS_ROUTE_PREFIX,
	SYNC_API_PATH,
	SP_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTIONS_API_PATH,
} from '@nestidp/shared';
import { toApiConnectionDto } from '../api-connections/api-connections.mapper';
import { IdpSettingsService } from '../idp-settings/idp-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildIdpUrls } from '../idp-settings/idp-settings.mapper';
import { AdminStatsService } from './admin-stats.service';

@Injectable()
export class AdminDashboardService {
	constructor(
		private readonly adminStatsService: AdminStatsService,
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly idpSettingsService: IdpSettingsService,
	) {}

	async getDashboard(): Promise<AdminDashboardResponseDto> {
		const counts = await this.adminStatsService.getCounts();
		const base = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const connectionRow = await this.prisma.apiConnection.findFirst({
			orderBy: { createdAt: 'asc' },
		});

		const entityId = settings?.entityId ?? base;
		const urls = buildIdpUrls(base);
		const idp = settings
			? await this.idpSettingsService.buildDashboardIdpStatus()
			: {
					idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
					hasSigningCertificate: false,
					rotationActive: false,
					signingCertNotAfter: null,
					certStatus: 'missing' as const,
				};

		return {
			counts,
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
			identityUsersRoute: `${IDENTITY_ROUTE_PREFIX}/users`,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: urls.metadataUrl,
			entityId,
			ssoUrl: urls.ssoUrl,
			idp,
			apiConnection: connectionRow ? toApiConnectionDto(connectionRow) : null,
			lastSyncStatus: connectionRow?.lastSyncStatus ?? null,
			lastSyncAt: connectionRow?.lastSyncAt?.toISOString() ?? null,
			auditEventsRoute: AUDIT_ROUTE_PREFIX,
			adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
		};
	}
}
