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
import { toApiConnectionDto } from '../../api-connections/mappers/api-connections.mapper';
import { IdpSettingsService } from '../../idp-settings/services/idp-settings.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import { buildIdpUrls } from '../../idp-settings/mappers/idp-settings.mapper';
import { AccountLockoutService } from '../../auth-protection/account-lockout.service';
import { AdminStatsService } from './admin-stats.service';

@Injectable()
export class AdminDashboardService {
	constructor(
		private readonly adminStatsService: AdminStatsService,
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly idpSettingsService: IdpSettingsService,
		private readonly accountLockout: AccountLockoutService,
	) {}

	async getDashboard(): Promise<AdminDashboardResponseDto> {
		const counts = await this.adminStatsService.getCounts();
		const lockouts = {
			lockedAdminAccounts: await this.accountLockout.countLocked('admin'),
			lockedUserAccounts: await this.accountLockout.countLocked('end_user'),
		};
		const base = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const connectionRow = await this.prisma.apiConnection.findFirst({
			where: { isLocalDirectory: false },
			orderBy: { createdAt: 'asc' },
		});

		const entityId = settings?.entityId ?? base;
		const urls = buildIdpUrls(base);
		const spSecurity = await this.buildSpSecuritySummary(
			settings?.wantAuthnRequestsSigned ?? false,
		);

		const idp = settings
			? await this.idpSettingsService.buildDashboardIdpStatus()
			: {
					idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
					hasSigningCertificate: false,
					rotationActive: false,
					signingCertNotAfter: null,
					signingKeyFamily: null,
					signingSignatureAlgorithmId: null,
					signingRsaModulusBits: null,
					signingEcCurve: null,
					certStatus: 'missing' as const,
					hasEncryptionCertificate: false,
					encryptionRotationActive: false,
					encryptionCertNotAfter: null,
					encryptionKeyFamily: null,
					encryptionKeyTransportAlgorithmId: null,
					encryptionRsaModulusBits: null,
					encryptionEcCurve: null,
					encryptionCertStatus: 'not_configured' as const,
				};

		return {
			counts,
			lockouts,
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
			spSecurity,
			apiConnection: connectionRow ? toApiConnectionDto(connectionRow) : null,
			lastSyncStatus: connectionRow?.lastSyncStatus ?? null,
			lastSyncAt: connectionRow?.lastSyncAt?.toISOString() ?? null,
			auditEventsRoute: AUDIT_ROUTE_PREFIX,
			adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
		};
	}

	private async buildSpSecuritySummary(idpAdvertisesSignedAuthnRequests: boolean) {
		const [
			requireSigned,
			requireEncrypted,
			flaggedRows,
			idpSettings,
			activeSamlSessions,
			backchannelUnresolved,
		] = await Promise.all([
			this.prisma.spConnection.count({ where: { wantAuthnRequestsSigned: true } }),
			this.prisma.spConnection.count({ where: { wantAssertionsEncrypted: true } }),
			this.prisma.spConnection.findMany({
				where: {
					OR: [{ wantAuthnRequestsSigned: true }, { wantAssertionsEncrypted: true }],
				},
				select: { spCertificate: true },
			}),
			this.prisma.idpSettings.findUnique({
				where: { id: 'default' },
				select: { encryptionKeyFamily: true },
			}),
			this.prisma.samlSsoSession.count({
				where: { status: 'active', expiresAt: { gt: new Date() } },
			}),
			// Sessions still logged in at some SP — unresolved back-channel deliveries (Prompt 36, item Q).
			this.prisma.samlBackchannelLogout.count({
				where: { status: { in: ['pending', 'in_flight', 'failed', 'given_up'] } },
			}),
		]);

		const missingCertCount = flaggedRows.filter((row) => !row.spCertificate?.trim()).length;

		return {
			spConnectionsRequireSignedAuthn: requireSigned,
			spConnectionsRequireEncryptedAssertions: requireEncrypted,
			spConnectionsMissingCertWithSecurityFlags: missingCertCount,
			idpAdvertisesSignedAuthnRequests,
			idpEncryptionKeyIsEc: idpSettings?.encryptionKeyFamily === 'ec',
			activeSamlSessions,
			backchannelUnresolved,
		};
	}
}
