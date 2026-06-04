import { ConfigService } from '@nestjs/config';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminStatsService } from './admin-stats.service';

describe('AdminDashboardService', () => {
	const adminStatsService = {
		getCounts: jest.fn(),
	} as unknown as AdminStatsService;

	const prisma = {
		idpSettings: { findUnique: jest.fn() },
		apiConnection: { findFirst: jest.fn() },
	};

	const idpSettingsService = {
		buildDashboardIdpStatus: jest.fn(),
	};

	const configService = {
		get: jest.fn(() => 'http://localhost:3000'),
	} as unknown as ConfigService;

	const service = new AdminDashboardService(
		adminStatsService,
		prisma as never,
		configService,
		idpSettingsService as never,
	);

	beforeEach(() => {
		jest.clearAllMocks();
		adminStatsService.getCounts = jest.fn().mockResolvedValue({
			users: 1,
			groups: 2,
			roles: 3,
			apiConnections: 1,
			spConnections: 0,
		});
		prisma.idpSettings.findUnique.mockResolvedValue({ entityId: 'http://localhost:3000' });
		prisma.apiConnection.findFirst.mockResolvedValue(null);
		idpSettingsService.buildDashboardIdpStatus.mockResolvedValue({
			idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
			hasSigningCertificate: true,
			rotationActive: false,
			signingCertNotAfter: '2030-01-01T00:00:00.000Z',
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
			certStatus: 'ok',
		});
	});

	it('API-ADM-DASH-SVC-01: builds dashboard with null apiConnection', async () => {
		const result = await service.getDashboard();

		expect(result.counts.users).toBe(1);
		expect(result.apiConnection).toBeNull();
		expect(result.lastSyncStatus).toBeNull();
		expect(result.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(result.identityUsersRoute).toContain('/admin/identity/users');
		expect(result.auditEventsRoute).toBe('/admin/audit');
		expect(result.adminUsersRoute).toBe('/admin/settings/admins');
	});

	it('API-ADM-DASH-16: dashboard idp block exposes signing crypto summary fields', async () => {
		const result = await service.getDashboard();
		expect(result.idp.signingKeyFamily).toBe('rsa');
		expect(result.idp.signingSignatureAlgorithmId).toBe('rsa-sha256');
		expect(result.idp.signingRsaModulusBits).toBe(2048);
	});

	it('API-ADM-DASH-SVC-02: includes apiConnection and sync fields', async () => {
		const finishedAt = new Date('2026-02-01T12:00:00.000Z');
		prisma.apiConnection.findFirst.mockResolvedValue({
			id: 'c1234567890123456789012345',
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			authType: 'BEARER',
			authCredentialsEncrypted: 'enc',
			lastSyncAt: finishedAt,
			lastSyncStatus: 'SUCCESS',
			createdAt: finishedAt,
			updatedAt: finishedAt,
		});

		const result = await service.getDashboard();

		expect(result.apiConnection?.name).toBe('Corp');
		expect(result.lastSyncStatus).toBe('SUCCESS');
		expect(result.lastSyncAt).toBe(finishedAt.toISOString());
		expect(result.apiConnection).not.toHaveProperty('authCredentialsEncrypted');
	});

	it('API-ADM-DASH-SVC-03: falls back entityId to IDP_BASE_URL when settings missing', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue(null);

		const result = await service.getDashboard();

		expect(result.entityId).toBe('http://localhost:3000');
	});

	it('API-ADM-DASH-SVC-04: includes idp block from IdpSettingsService', async () => {
		const result = await service.getDashboard();

		expect(idpSettingsService.buildDashboardIdpStatus).toHaveBeenCalled();
		expect(result.idp).toEqual({
			idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
			hasSigningCertificate: true,
			rotationActive: false,
			signingCertNotAfter: '2030-01-01T00:00:00.000Z',
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
			certStatus: 'ok',
		});
	});

	it('API-ADM-DASH-SVC-05: idp missing cert defaults when settings row absent', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue(null);

		const result = await service.getDashboard();

		expect(idpSettingsService.buildDashboardIdpStatus).not.toHaveBeenCalled();
		expect(result.idp).toEqual({
			idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
			hasSigningCertificate: false,
			rotationActive: false,
			signingCertNotAfter: null,
			signingKeyFamily: null,
			signingSignatureAlgorithmId: null,
			signingRsaModulusBits: null,
			signingEcCurve: null,
			certStatus: 'missing',
		});
	});
});
