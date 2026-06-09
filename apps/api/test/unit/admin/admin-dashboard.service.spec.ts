import { ConfigService } from '@nestjs/config';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminDashboardService } from '@api/admin/services/admin-dashboard.service';
import { AdminStatsService } from '@api/admin/services/admin-stats.service';

describe('AdminDashboardService', () => {
	const adminStatsService = {
		getCounts: jest.fn(),
	} as unknown as AdminStatsService;

	const prisma = {
		idpSettings: { findUnique: jest.fn() },
		apiConnection: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
		spConnection: { count: jest.fn(), findMany: jest.fn() },
		samlSsoSession: { count: jest.fn().mockResolvedValue(0) },
		samlBackchannelLogout: { count: jest.fn().mockResolvedValue(0) },
	};

	const idpSettingsService = {
		buildDashboardIdpStatus: jest.fn(),
	};

	const configService = {
		get: jest.fn(() => 'http://localhost:3000'),
	} as unknown as ConfigService;

	const accountLockout = {
		countLocked: jest.fn().mockResolvedValue(0),
	};

	const identityStore = {
		countsByConnection: jest.fn().mockResolvedValue({ users: {}, groups: {}, roles: {} }),
	};
	const multiSourceConfig = {
		syncSourceStaleFactor: jest.fn().mockReturnValue(3),
	};

	const service = new AdminDashboardService(
		adminStatsService,
		prisma as never,
		configService,
		idpSettingsService as never,
		accountLockout as never,
		identityStore as never,
		multiSourceConfig as never,
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
		prisma.idpSettings.findUnique.mockResolvedValue({
			entityId: 'http://localhost:3000',
			wantAuthnRequestsSigned: false,
		});
		prisma.apiConnection.findFirst.mockResolvedValue(null);
		prisma.spConnection.count.mockResolvedValue(0);
		prisma.spConnection.findMany.mockResolvedValue([]);
		prisma.samlSsoSession.count.mockResolvedValue(0);
		prisma.samlBackchannelLogout.count.mockResolvedValue(0);
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
			hasEncryptionCertificate: false,
			encryptionRotationActive: false,
			encryptionCertNotAfter: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			encryptionCertStatus: 'not_configured',
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

	describe('multi-source sync sources (Prompt 37)', () => {
		const now = Date.now();
		const baseConn = (over: Record<string, unknown>) => ({
			id: 'c1',
			name: 'Src',
			lastSyncStatus: 'SUCCESS',
			lastSyncAt: new Date(now - 1000),
			lastCollisionCount: 0,
			includeInSyncAll: true,
			scheduleEnabled: false,
			schedulePaused: false,
			lastScheduledRunAt: null,
			nextRunAt: null,
			...over,
		});

		it('MAS-DASH-01: lists each source with per-source counts + local bucket', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([baseConn({ id: 'c1', name: 'A' })]);
			// Two findFirst calls share the mock: the local-directory lookup vs the legacy singular source.
			prisma.apiConnection.findFirst.mockImplementation(
				(args: { where?: { isLocalDirectory?: boolean } }) =>
					args?.where?.isLocalDirectory ? { id: 'local-1' } : null,
			);
			identityStore.countsByConnection.mockResolvedValue({
				users: { c1: 7, 'local-1': 3 },
				groups: { c1: 2 },
				roles: {},
			});

			const res = await service.getDashboard();

			expect(res.syncSources).toHaveLength(1);
			expect(res.syncSources?.[0]).toMatchObject({
				apiConnectionId: 'c1',
				userCount: 7,
				groupCount: 2,
				roleCount: 0,
				state: 'ok',
			});
			expect(res.manualIdentityCount).toBe(3);
			expect(res.syncSourceHealth?.unhealthy).toBe(0);
		});

		it('MAS-DASH-02: classifies never-synced + failing + overdue and rolls them into unhealthy', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([
				baseConn({ id: 'never', lastSyncStatus: 'NEVER', lastSyncAt: null }),
				baseConn({ id: 'fail', lastSyncStatus: 'FAILED' }),
				baseConn({
					id: 'overdue',
					lastSyncStatus: 'SUCCESS',
					scheduleEnabled: true,
					lastScheduledRunAt: new Date(now - 10 * 60_000),
					nextRunAt: new Date(now - 5 * 60_000),
					// last real sync long ago → older than interval(5m) × staleFactor(3)
					lastSyncAt: new Date(now - 60 * 60_000),
				}),
				baseConn({ id: 'ok' }),
			]);
			prisma.apiConnection.findFirst.mockResolvedValue(null);

			const res = await service.getDashboard();

			const byId = Object.fromEntries(
				(res.syncSources ?? []).map((s) => [s.apiConnectionId, s.state]),
			);
			expect(byId.never).toBe('never_synced');
			expect(byId.fail).toBe('failing');
			expect(byId.overdue).toBe('overdue');
			expect(byId.ok).toBe('ok');
			expect(res.syncSourceHealth).toMatchObject({
				total: 4,
				neverSynced: 1,
				failing: 1,
				overdue: 1,
				unhealthy: 3,
			});
		});

		it('MAS-DASH-03: "all-local" / no sources renders an empty list + zero health', async () => {
			prisma.apiConnection.findMany.mockResolvedValue([]);
			const res = await service.getDashboard();
			expect(res.syncSources).toEqual([]);
			expect(res.syncSourceHealth).toMatchObject({ total: 0, unhealthy: 0 });
		});
	});

	it('API-ADM-DASH-16: dashboard idp block exposes signing crypto summary fields', async () => {
		const result = await service.getDashboard();
		expect(result.idp.signingKeyFamily).toBe('rsa');
		expect(result.idp.signingSignatureAlgorithmId).toBe('rsa-sha256');
		expect(result.idp.signingRsaModulusBits).toBe(2048);
	});

	it('API-ADM-DASH-BC-Q: surfaces the unresolved back-channel logout count (Prompt 36, item Q)', async () => {
		prisma.samlBackchannelLogout.count.mockResolvedValue(4);
		const result = await service.getDashboard();
		expect(result.spSecurity.backchannelUnresolved).toBe(4);
		// only unresolved states are counted (pending/in_flight/failed/given_up) — not succeeded/skipped
		expect(prisma.samlBackchannelLogout.count).toHaveBeenCalledWith({
			where: { status: { in: ['pending', 'in_flight', 'failed', 'given_up'] } },
		});
	});

	it('API-ADM-DASH-BC-Q0: reports zero unresolved when the queue is clean', async () => {
		prisma.samlBackchannelLogout.count.mockResolvedValue(0);
		const result = await service.getDashboard();
		expect(result.spSecurity.backchannelUnresolved).toBe(0);
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
			hasEncryptionCertificate: false,
			encryptionRotationActive: false,
			encryptionCertNotAfter: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			encryptionCertStatus: 'not_configured',
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
			hasEncryptionCertificate: false,
			encryptionRotationActive: false,
			encryptionCertNotAfter: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			encryptionCertStatus: 'not_configured',
		});
	});

	it('API-ADM-DASH-SVC-06: includes the brute-force lockout summary (Prompt 35)', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue(null);
		accountLockout.countLocked = jest
			.fn()
			.mockResolvedValueOnce(2) // admin
			.mockResolvedValueOnce(3); // end_user

		const result = await service.getDashboard();

		expect(result.lockouts).toEqual({ lockedAdminAccounts: 2, lockedUserAccounts: 3 });
	});
});
