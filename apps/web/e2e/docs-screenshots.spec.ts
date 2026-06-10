import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Docs screenshot spec — writes directly to docs/img/*.png
//
// Guard: skip unless DOCS_SCREENSHOTS=1 is explicitly set.
// Running pnpm test:e2e without the flag will skip this spec automatically
// so CI never overwrites committed screenshots.
// ---------------------------------------------------------------------------

test.describe('Docs screenshots', () => {
	test.skip(
		!process.env.DOCS_SCREENSHOTS,
		'Docs screenshot spec only runs when DOCS_SCREENSHOTS=1 is set',
	);

	// From apps/web/e2e/ → ../../../docs/img/
	function img(filename: string): string {
		return path.join(_dirname, '../../../docs/img', filename);
	}

	// ---------------------------------------------------------------------------
	// Shared mock data
	// ---------------------------------------------------------------------------

	const ENTITY_ID = 'https://idp.acme.corp';
	const CERT_EXPIRY = '2028-03-15T00:00:00.000Z';
	const ENCRYPTION_CERT_EXPIRY = '2027-06-01T00:00:00.000Z';
	const LAST_SYNC = '2026-05-20T08:15:00.000Z';
	const CERT_FINGERPRINT =
		'ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90';

	const AUTO_ROTATION_OFF = {
		enabled: false,
		disabledAt: null,
		consecutiveFailures: 0,
		lastError: null,
		willAutoStartBy: null,
		willAutoCompleteAt: null,
	};

	const SIGNING_ROTATION_INACTIVE = {
		active: false,
		startedAt: null,
		hasPendingCertificate: false,
		pendingCertFingerprintSha256: null,
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		pendingSigningCertNotAfter: null,
		auto: AUTO_ROTATION_OFF,
	};

	const ENCRYPTION_ROTATION_INACTIVE = {
		active: false,
		startedAt: null,
		hasPendingCertificate: false,
		pendingCertFingerprintSha256: null,
		pendingEncryptionKeyFamily: null,
		pendingEncryptionKeyTransportAlgorithmId: null,
		pendingEncryptionRsaModulusBits: null,
		pendingEncryptionEcCurve: null,
		pendingEncryptionCertNotAfter: null,
		auto: AUTO_ROTATION_OFF,
	};

	function idpSettingsMock(opts: {
		hasSigningCertificate: boolean;
		hasEncryptionCertificate: boolean;
	}) {
		return {
			entityId: ENTITY_ID,
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: false,
			hasSigningCertificate: opts.hasSigningCertificate,
			signingCertFingerprintSha256: opts.hasSigningCertificate ? CERT_FINGERPRINT : null,
			signingCertNotAfter: opts.hasSigningCertificate ? CERT_EXPIRY : null,
			signingKeyFamily: opts.hasSigningCertificate ? 'RSA' : null,
			signingSignatureAlgorithmId: opts.hasSigningCertificate ? 'rsa-sha256' : null,
			signingRsaModulusBits: opts.hasSigningCertificate ? 2048 : null,
			signingEcCurve: null,
			metadataUrl: `${ENTITY_ID}/saml/metadata`,
			ssoUrl: `${ENTITY_ID}/saml/sso`,
			idpBaseUrl: ENTITY_ID,
			rotation: SIGNING_ROTATION_INACTIVE,
			hasEncryptionCertificate: opts.hasEncryptionCertificate,
			encryptionCertFingerprintSha256: opts.hasEncryptionCertificate ? CERT_FINGERPRINT : null,
			encryptionCertNotAfter: opts.hasEncryptionCertificate ? ENCRYPTION_CERT_EXPIRY : null,
			encryptionKeyFamily: opts.hasEncryptionCertificate ? 'RSA' : null,
			encryptionKeyTransportAlgorithmId: opts.hasEncryptionCertificate ? 'rsa-oaep-mgf1p' : null,
			encryptionRsaModulusBits: opts.hasEncryptionCertificate ? 2048 : null,
			encryptionEcCurve: null,
			encryptionRotation: ENCRYPTION_ROTATION_INACTIVE,
			lastAutoRotationCheckAt: null,
			lastAutoRotationActionAt: null,
			updatedAt: LAST_SYNC,
		};
	}

	// ---------------------------------------------------------------------------
	// Shared helpers
	// ---------------------------------------------------------------------------

	async function mockAdminUnauth(page: Page) {
		await page.route('**/api/admin/auth/me', (route) =>
			route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
			}),
		);
	}

	async function mockAdminAuth(page: Page) {
		await page.route('**/api/admin/auth/me', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ admin: { id: '1', username: 'admin' }, csrfToken: 'mock-csrf' }),
			}),
		);
	}

	async function mockDashboard(page: Page) {
		await page.route('**/api/admin', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					counts: { users: 142, groups: 8, roles: 5, apiConnections: 2, spConnections: 3 },
					apiConnectionsRoute: '/admin/api-connections',
					spConnectionsRoute: '/admin/sp-connections',
					identityUsersRoute: '/admin/identity/users',
					apiConnectionsApiPath: '/api/admin/api-connections',
					syncApiPath: '/api/admin/sync',
					spConnectionsApiPath: '/api/admin/sp-connections',
					metadataUrl: `${ENTITY_ID}/saml/metadata`,
					entityId: ENTITY_ID,
					ssoUrl: `${ENTITY_ID}/saml/sso`,
					idp: {
						idpSettingsRoute: '/admin/settings/idp',
						hasSigningCertificate: true,
						rotationActive: false,
						signingCertNotAfter: CERT_EXPIRY,
						certStatus: 'ok',
						hasEncryptionCertificate: true,
						encryptionRotationActive: false,
						encryptionCertNotAfter: ENCRYPTION_CERT_EXPIRY,
						encryptionKeyFamily: 'RSA',
						encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
						encryptionRsaModulusBits: 2048,
						encryptionEcCurve: null,
						encryptionCertStatus: 'ok',
					},
					spSecurity: {
						spConnectionsRequireSignedAuthn: 1,
						spConnectionsRequireEncryptedAssertions: 2,
						spConnectionsMissingCertWithSecurityFlags: 0,
						idpAdvertisesSignedAuthnRequests: false,
					},
					apiConnection: {
						id: 'conn-001',
						name: 'HR System',
						lastSyncStatus: 'SUCCESS',
						lastSyncAt: LAST_SYNC,
					},
					lastSyncStatus: 'SUCCESS',
					lastSyncAt: LAST_SYNC,
					auditEventsRoute: '/admin/audit',
					adminUsersRoute: '/admin/settings/admins',
				}),
			});
		});
	}

	async function mockIdpSettings(
		page: Page,
		opts: { hasSigningCertificate: boolean; hasEncryptionCertificate: boolean },
	) {
		await page.route('**/api/admin/idp/settings', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(idpSettingsMock(opts)),
			}),
		);
	}

	// ---------------------------------------------------------------------------
	// 1. Admin login page
	// ---------------------------------------------------------------------------

	test('admin-login', async ({ page }) => {
		await mockAdminUnauth(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/login');
		await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
		await page.screenshot({ path: img('admin-login.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 2. Dashboard
	// ---------------------------------------------------------------------------

	test('admin-dashboard', async ({ page }) => {
		await mockAdminAuth(page);
		await mockDashboard(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
		await page.screenshot({ path: img('admin-dashboard.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 3–7. IdP settings — multiple states from the same page
	// ---------------------------------------------------------------------------

	test('idp-settings-overview', async ({ page }) => {
		await mockAdminAuth(page);
		await mockIdpSettings(page, { hasSigningCertificate: false, hasEncryptionCertificate: false });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: /idp settings/i })).toBeVisible();
		await page.screenshot({ path: img('idp-settings-overview.png'), fullPage: true });
	});

	test('idp-settings-certificate-metadata', async ({ page }) => {
		await mockAdminAuth(page);
		await mockIdpSettings(page, { hasSigningCertificate: true, hasEncryptionCertificate: false });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: /idp settings/i })).toBeVisible();
		// Wait for certificate fingerprint to confirm the cert panel loaded
		await expect(page.locator('text=ab:cd:ef').first()).toBeVisible();
		await page.screenshot({ path: img('idp-settings-certificate-metadata.png'), fullPage: true });
	});

	test('idp-settings-signing-and-encryption', async ({ page }) => {
		await mockAdminAuth(page);
		await mockIdpSettings(page, { hasSigningCertificate: true, hasEncryptionCertificate: true });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: /idp settings/i })).toBeVisible();
		await expect(page.locator('text=ab:cd:ef').first()).toBeVisible();
		await page.screenshot({ path: img('idp-settings-signing-and-encryption.png'), fullPage: true });
	});

	test('idp-settings-encryption-cert-options', async ({ page }) => {
		await mockAdminAuth(page);
		await mockIdpSettings(page, { hasSigningCertificate: true, hasEncryptionCertificate: true });
		// Mock the cert-rotation status endpoint that the generate panel may fetch
		await page.route('**/api/admin/idp/settings/cert-rotation/status', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					signing: {
						certNotAfter: CERT_EXPIRY,
						auto: AUTO_ROTATION_OFF,
					},
					encryption: {
						certNotAfter: ENCRYPTION_CERT_EXPIRY,
						auto: AUTO_ROTATION_OFF,
					},
					lastAutoRotationCheckAt: null,
					lastAutoRotationActionAt: null,
				}),
			}),
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: /idp settings/i })).toBeVisible();
		// Click Generate button in the encryption cert panel
		const generateBtn = page
			.getByRole('button', { name: /generate/i })
			.filter({ hasNot: page.locator('[disabled]') })
			.last();
		await generateBtn.click();
		// Wait for options form to appear (key type selector or similar)
		await expect(
			page
				.getByRole('combobox')
				.or(page.locator('select'))
				.or(page.locator('[data-role="key-type"]'))
				.first(),
		)
			.toBeVisible({ timeout: 5000 })
			.catch(() => {
				// If options form doesn't appear exactly as expected, just screenshot what we have
			});
		await page.screenshot({
			path: img('idp-settings-encryption-cert-options.png'),
			fullPage: true,
		});
	});

	test('idp-settings-upload-certificate', async ({ page }) => {
		await mockAdminAuth(page);
		await mockIdpSettings(page, { hasSigningCertificate: false, hasEncryptionCertificate: false });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: /idp settings/i })).toBeVisible();
		// Click Upload/Paste button in the signing cert panel
		const uploadBtn = page.getByRole('button', { name: /upload|paste pem/i }).first();
		await uploadBtn.click();
		// Wait for PEM textarea
		await expect(page.locator('textarea').first())
			.toBeVisible({ timeout: 5000 })
			.catch(() => {
				// Screenshot anyway
			});
		await page.screenshot({ path: img('idp-settings-upload-certificate.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 8. API connection edit form
	// ---------------------------------------------------------------------------

	test('api-connection-edit', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/api-connections/conn-001', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					connection: {
						id: 'conn-001',
						name: 'HR System',
						baseUrl: 'https://hr.acme.corp/api/v1',
						authType: 'BEARER',
						hasBearerToken: true,
						apiContractConfig: null,
						oauthTokenUrl: null,
						oauthClientId: null,
						oauthScope: null,
						oauthAudience: null,
						oauthClientAuthMethod: null,
						oauthTokenRequestParams: null,
						hasOauthClientSecret: false,
						oauthLastTokenAt: null,
						proxyEnabled: false,
						proxyUrl: null,
						proxyUsername: null,
						hasProxyPassword: false,
						noProxyHosts: null,
						lastProxyCheckStatus: null,
						lastProxyCheckAt: null,
						lastSyncAt: LAST_SYNC,
						lastSyncStatus: 'SUCCESS',
						isLocalDirectory: false,
						includeInSyncAll: true,
						usernameCollisionPolicy: null,
						lastCollisionCount: 0,
						syncedUserCount: 138,
						syncedGroupCount: 8,
						syncedRoleCount: 5,
						createdAt: '2025-01-15T09:00:00.000Z',
						updatedAt: LAST_SYNC,
					},
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/api-connections/conn-001');
		await expect(
			page
				.locator('input[name="name"]')
				.or(page.getByRole('heading', { name: /hr system|api connection/i }))
				.first(),
		).toBeVisible();
		await page.screenshot({ path: img('api-connection-edit.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 9. API connection sync page
	// ---------------------------------------------------------------------------

	test('api-connection-sync', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/api-connections/conn-001', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					connection: {
						id: 'conn-001',
						name: 'HR System',
						baseUrl: 'https://hr.acme.corp/api/v1',
						authType: 'BEARER',
						hasBearerToken: true,
						apiContractConfig: null,
						oauthTokenUrl: null,
						oauthClientId: null,
						oauthScope: null,
						oauthAudience: null,
						oauthClientAuthMethod: null,
						oauthTokenRequestParams: null,
						hasOauthClientSecret: false,
						oauthLastTokenAt: null,
						proxyEnabled: false,
						proxyUrl: null,
						proxyUsername: null,
						hasProxyPassword: false,
						noProxyHosts: null,
						lastProxyCheckStatus: null,
						lastProxyCheckAt: null,
						lastSyncAt: LAST_SYNC,
						lastSyncStatus: 'SUCCESS',
						isLocalDirectory: false,
						includeInSyncAll: true,
						usernameCollisionPolicy: null,
						lastCollisionCount: 4,
						syncedUserCount: 138,
						syncedGroupCount: 8,
						syncedRoleCount: 5,
						createdAt: '2025-01-15T09:00:00.000Z',
						updatedAt: LAST_SYNC,
					},
				}),
			});
		});
		await page.route('**/api/admin/sync/conn-001/logs**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					syncLogs: [
						{
							id: 'log-001',
							apiConnectionId: 'conn-001',
							startedAt: LAST_SYNC,
							finishedAt: '2026-05-20T08:16:45.000Z',
							durationMs: 105000,
							status: 'SUCCESS',
							usersSynced: 138,
							groupsSynced: 8,
							rolesSynced: 5,
							usersSkippedCollision: 4,
							groupsDeactivated: 1,
							rolesDeactivated: 0,
							dryRun: false,
							triggerSource: 'manual',
							errors: null,
						},
					],
				}),
			}),
		);
		// Also mock the sync status endpoint
		await page.route('**/api/admin/sync/conn-001/status**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					connectionId: 'conn-001',
					lastSyncAt: LAST_SYNC,
					lastSyncStatus: 'SUCCESS',
					syncInProgress: false,
					latestSyncLog: {
						id: 'log-001',
						apiConnectionId: 'conn-001',
						startedAt: LAST_SYNC,
						finishedAt: '2026-05-20T08:16:45.000Z',
						durationMs: 105000,
						status: 'SUCCESS',
						usersSynced: 138,
						groupsSynced: 8,
						rolesSynced: 5,
						usersSkippedCollision: 4,
						groupsDeactivated: 1,
						rolesDeactivated: 0,
						dryRun: false,
						triggerSource: 'manual',
						errors: null,
					},
				}),
			}),
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/api-connections/conn-001/sync');
		await expect(page.locator('text=138').or(page.locator('text=SUCCESS')).first()).toBeVisible();
		await page.screenshot({ path: img('api-connection-sync.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 10. API connections list
	// ---------------------------------------------------------------------------

	test('api-connections-list', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/api-connections', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					connections: [
						{
							id: 'conn-001',
							name: 'HR System',
							baseUrl: 'https://hr.acme.corp/api/v1',
							authType: 'BEARER',
							hasBearerToken: true,
							apiContractConfig: null,
							oauthTokenUrl: null,
							oauthClientId: null,
							oauthScope: null,
							oauthAudience: null,
							oauthClientAuthMethod: null,
							oauthTokenRequestParams: null,
							hasOauthClientSecret: false,
							oauthLastTokenAt: null,
							proxyEnabled: false,
							proxyUrl: null,
							proxyUsername: null,
							hasProxyPassword: false,
							noProxyHosts: null,
							lastProxyCheckStatus: null,
							lastProxyCheckAt: null,
							lastSyncAt: LAST_SYNC,
							lastSyncStatus: 'SUCCESS',
							isLocalDirectory: false,
							includeInSyncAll: true,
							usernameCollisionPolicy: null,
							lastCollisionCount: 4,
							syncedUserCount: 138,
							syncedGroupCount: 8,
							syncedRoleCount: 5,
							createdAt: '2025-01-15T09:00:00.000Z',
							updatedAt: LAST_SYNC,
						},
						{
							id: 'conn-002',
							name: 'Active Directory Proxy',
							baseUrl: 'https://ad-proxy.acme.corp/idp',
							authType: 'OAUTH2',
							hasBearerToken: false,
							apiContractConfig: null,
							oauthTokenUrl: 'https://ad-proxy.acme.corp/oauth/token',
							oauthClientId: 'nestidp-sync',
							oauthScope: 'read:users',
							oauthAudience: null,
							oauthClientAuthMethod: 'client_secret_post',
							oauthTokenRequestParams: null,
							hasOauthClientSecret: true,
							oauthLastTokenAt: LAST_SYNC,
							proxyEnabled: false,
							proxyUrl: null,
							proxyUsername: null,
							hasProxyPassword: false,
							noProxyHosts: null,
							lastProxyCheckStatus: null,
							lastProxyCheckAt: null,
							lastSyncAt: '2026-05-19T06:00:00.000Z',
							lastSyncStatus: 'SUCCESS',
							isLocalDirectory: false,
							includeInSyncAll: true,
							usernameCollisionPolicy: 'skip',
							lastCollisionCount: 0,
							syncedUserCount: 4,
							syncedGroupCount: 0,
							syncedRoleCount: 0,
							createdAt: '2025-06-01T10:00:00.000Z',
							updatedAt: '2026-05-19T06:01:00.000Z',
						},
					],
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/api-connections');
		await expect(page.locator('text=HR System')).toBeVisible();
		await page.screenshot({ path: img('api-connections-list.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 11. Identity users list
	// ---------------------------------------------------------------------------

	test('identity-users-list', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/identity/sources**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					sources: [
						{ apiConnectionId: 'conn-001', label: 'HR System', isLocalDirectory: false },
						{ apiConnectionId: 'local', label: 'Local directory', isLocalDirectory: true },
					],
				}),
			}),
		);
		await page.route('**/api/admin/identity/users**', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'u1',
							username: 'alice.johnson',
							email: 'alice.johnson@acme.corp',
							displayName: 'Alice Johnson',
							active: true,
							externalId: 'hr:usr:001',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							lockout: null,
						},
						{
							id: 'u2',
							username: 'bob.smith',
							email: 'bob.smith@acme.corp',
							displayName: 'Bob Smith',
							active: true,
							externalId: 'hr:usr:002',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							lockout: null,
						},
						{
							id: 'u3',
							username: 'carol.white',
							email: 'carol.white@acme.corp',
							displayName: 'Carol White',
							active: true,
							externalId: 'hr:usr:003',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							lockout: null,
						},
						{
							id: 'u4',
							username: 'dave.brown',
							email: 'dave.brown@acme.corp',
							displayName: 'Dave Brown',
							active: false,
							externalId: 'hr:usr:004',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							lockout: null,
						},
						{
							id: 'u5',
							username: 'eve.operations',
							email: 'eve@acme.corp',
							displayName: 'Eve (Ops)',
							active: true,
							externalId: 'manual:user:u5',
							apiConnectionId: 'local',
							origin: 'manual',
							lockout: null,
						},
					],
					total: 142,
					sources: [
						{ apiConnectionId: 'conn-001', label: 'HR System', isLocalDirectory: false },
						{ apiConnectionId: 'local', label: 'Local directory', isLocalDirectory: true },
					],
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/identity/users');
		await expect(
			page
				.locator('text=alice.johnson')
				.or(page.getByRole('heading', { name: /users/i }))
				.first(),
		).toBeVisible();
		await page.screenshot({ path: img('identity-users-list.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 12. Identity groups list
	// ---------------------------------------------------------------------------

	test('identity-groups-list', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/identity/sources**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					sources: [{ apiConnectionId: 'conn-001', label: 'HR System', isLocalDirectory: false }],
				}),
			}),
		);
		await page.route('**/api/admin/identity/groups**', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'g1',
							name: 'engineering',
							externalId: 'hr:grp:eng',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 87,
						},
						{
							id: 'g2',
							name: 'operations',
							externalId: 'hr:grp:ops',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 31,
						},
						{
							id: 'g3',
							name: 'finance',
							externalId: 'hr:grp:fin',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 24,
						},
					],
					total: 8,
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/identity/groups');
		await expect(
			page
				.locator('text=engineering')
				.or(page.getByRole('heading', { name: /groups/i }))
				.first(),
		).toBeVisible();
		await page.screenshot({ path: img('identity-groups-list.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 13. Identity roles list
	// ---------------------------------------------------------------------------

	test('identity-roles-list', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/identity/sources**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					sources: [{ apiConnectionId: 'conn-001', label: 'HR System', isLocalDirectory: false }],
				}),
			}),
		);
		await page.route('**/api/admin/identity/roles**', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'r1',
							name: 'admin',
							externalId: 'hr:role:admin',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 4,
						},
						{
							id: 'r2',
							name: 'viewer',
							externalId: 'hr:role:viewer',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 138,
						},
						{
							id: 'r3',
							name: 'editor',
							externalId: 'hr:role:editor',
							apiConnectionId: 'conn-001',
							origin: 'synced',
							memberCount: 29,
						},
					],
					total: 5,
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/identity/roles');
		await expect(
			page
				.locator('text=viewer')
				.or(page.getByRole('heading', { name: /roles/i }))
				.first(),
		).toBeVisible();
		await page.screenshot({ path: img('identity-roles-list.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 14. SP connections list
	// ---------------------------------------------------------------------------

	test('sp-connections-list', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/sp-connections', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'sp-001',
							name: 'Grafana Cloud',
							spEntityId: 'https://grafana.com',
							acsUrl: 'https://grafana.com/auth/saml/callback',
							sloUrl: null,
							sloSoapUrl: null,
							nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
							attributeMapping: null,
							active: true,
							hasSpCertificate: true,
							wantAssertionsEncrypted: true,
							wantAuthnRequestsSigned: false,
							wantLogoutRequestsSigned: false,
							lastBackchannelLogoutStatus: null,
							lastBackchannelLogoutAt: null,
							createdAt: '2025-02-01T10:00:00.000Z',
							updatedAt: LAST_SYNC,
						},
						{
							id: 'sp-002',
							name: 'Internal App',
							spEntityId: 'https://app.acme.corp/saml/metadata',
							acsUrl: 'https://app.acme.corp/saml/acs',
							sloUrl: 'https://app.acme.corp/saml/slo',
							sloSoapUrl: 'https://app.acme.corp/saml/slo/soap',
							nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
							attributeMapping: null,
							active: true,
							hasSpCertificate: true,
							wantAssertionsEncrypted: true,
							wantAuthnRequestsSigned: true,
							wantLogoutRequestsSigned: true,
							lastBackchannelLogoutStatus: 'delivered',
							lastBackchannelLogoutAt: LAST_SYNC,
							createdAt: '2025-03-10T08:00:00.000Z',
							updatedAt: LAST_SYNC,
						},
						{
							id: 'sp-003',
							name: 'Staging',
							spEntityId: 'https://staging.acme.corp/saml/metadata',
							acsUrl: 'https://staging.acme.corp/saml/acs',
							sloUrl: null,
							sloSoapUrl: null,
							nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
							attributeMapping: null,
							active: false,
							hasSpCertificate: false,
							wantAssertionsEncrypted: false,
							wantAuthnRequestsSigned: false,
							wantLogoutRequestsSigned: false,
							lastBackchannelLogoutStatus: null,
							lastBackchannelLogoutAt: null,
							createdAt: '2025-08-01T12:00:00.000Z',
							updatedAt: '2025-08-01T12:00:00.000Z',
						},
					],
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/sp-connections');
		await expect(page.locator('text=Grafana Cloud')).toBeVisible();
		await page.screenshot({ path: img('sp-connections-list.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 15. New SP connection form (pre-filled with Grafana example)
	// ---------------------------------------------------------------------------

	test('sp-connection-new-grafana', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/sp-connections', (route) => {
			if (route.request().method() === 'GET') {
				void route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			void route.continue();
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/sp-connections/new');
		// Wait for the form to load
		await expect(
			page
				.locator('input[name="name"]')
				.or(page.getByRole('heading', { name: /new sp connection|create/i }))
				.first(),
		).toBeVisible();
		// Fill Grafana Cloud example values
		const nameInput = page.locator('input[name="name"]');
		if (await nameInput.isVisible()) {
			await nameInput.fill('Grafana Cloud');
		}
		const entityIdInput = page.locator('input[name="spEntityId"]');
		if (await entityIdInput.isVisible()) {
			await entityIdInput.fill('https://grafana.com');
		}
		const acsInput = page.locator('input[name="acsUrl"]');
		if (await acsInput.isVisible()) {
			await acsInput.fill('https://grafana.com/auth/saml/callback');
		}
		await page.screenshot({ path: img('sp-connection-new-grafana.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 16. Audit log with filters visible
	// ---------------------------------------------------------------------------

	test('audit-log-filters', async ({ page }) => {
		await mockAdminAuth(page);
		await page.route('**/api/admin/audit**', (route) => {
			if (route.request().method() !== 'GET') {
				void route.continue();
				return;
			}
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'a1',
							category: 'admin_auth',
							event: 'admin_login_success',
							actorType: 'admin',
							actorId: '1',
							actorLabel: 'admin',
							subjectType: null,
							subjectId: null,
							clientIp: '192.168.1.10',
							metadata: null,
							createdAt: LAST_SYNC,
						},
						{
							id: 'a2',
							category: 'admin_config',
							event: 'sp_connection_created',
							actorType: 'admin',
							actorId: '1',
							actorLabel: 'admin',
							subjectType: 'sp_connection',
							subjectId: 'sp-001',
							clientIp: '192.168.1.10',
							metadata: { name: 'Grafana Cloud' },
							createdAt: '2026-05-20T07:50:00.000Z',
						},
						{
							id: 'a3',
							category: 'sync',
							event: 'sync_completed',
							actorType: 'system',
							actorId: null,
							actorLabel: null,
							subjectType: 'api_connection',
							subjectId: 'conn-001',
							clientIp: null,
							metadata: { usersSynced: 138, durationMs: 105000 },
							createdAt: '2026-05-20T07:45:00.000Z',
						},
						{
							id: 'a4',
							category: 'admin_config',
							event: 'idp_signing_auto_rotation_completed',
							actorType: 'system',
							actorId: null,
							actorLabel: null,
							subjectType: 'idp_settings',
							subjectId: null,
							clientIp: null,
							metadata: null,
							createdAt: '2026-05-19T12:00:00.000Z',
						},
						{
							id: 'a5',
							category: 'identity',
							event: 'identity_user_deactivated',
							actorType: 'system',
							actorId: null,
							actorLabel: null,
							subjectType: 'identity_user',
							subjectId: 'u4',
							clientIp: null,
							metadata: { username: 'dave.brown' },
							createdAt: '2026-05-19T08:00:00.000Z',
						},
					],
					total: 5,
					limit: 50,
					offset: 0,
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/audit');
		await expect(
			page
				.locator('text=admin_login_success')
				.or(page.getByRole('heading', { name: /audit/i }))
				.first(),
		).toBeVisible();
		// Wait for the filter controls to be visible
		await expect(page.locator('select, [role="combobox"]').first())
			.toBeVisible({ timeout: 5000 })
			.catch(() => {});
		await page.screenshot({ path: img('audit-log-filters.png'), fullPage: true });
	});

	// ---------------------------------------------------------------------------
	// 17. End-user SAML login page
	//
	// The login form only renders when there is an active pending SAML session.
	// Without a session the page shows a "no active request" notice.
	// Mock GET /api/auth/session?samlSessionId=... to inject a pending session.
	// ---------------------------------------------------------------------------

	test('saml-login', async ({ page }) => {
		await page.route('**/api/auth/session*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					authenticated: false,
					user: null,
					samlSession: {
						id: 'mock-session-123',
						bound: false,
						expired: false,
						spActive: true,
						readyToComplete: false,
					},
				}),
			}),
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/login?samlSessionId=mock-session-123');
		// Wait for login form (only visible with a pending session)
		await expect(
			page.locator('input[name="username"]').or(page.locator('input[type="text"]')).first(),
		).toBeVisible({ timeout: 8000 });
		await page.screenshot({ path: img('saml-login.png'), fullPage: true });
	});
});
