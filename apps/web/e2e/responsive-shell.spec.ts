import { test, expect } from '@playwright/test';
import type { AdminDashboardResponseDto } from '@nestidp/shared';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';

const dashboardStub: AdminDashboardResponseDto = {
	counts: { users: 2, groups: 1, roles: 1, apiConnections: 1, spConnections: 1 },
	apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
	spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
	identityUsersRoute: '/admin/identity/users',
	apiConnectionsApiPath: '/api/admin/api-connections',
	syncApiPath: '/api/admin/sync',
	spConnectionsApiPath: '/api/admin/sp-connections',
	metadataUrl: 'http://localhost:3000/saml/metadata',
	entityId: 'http://localhost:3000',
	ssoUrl: 'http://localhost:3000/saml/sso',
	idp: {
		idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
		hasSigningCertificate: true,
		rotationActive: false,
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		certStatus: 'ok',
		hasEncryptionCertificate: false,
		encryptionRotationActive: false,
		encryptionCertNotAfter: null,
		encryptionKeyFamily: null,
		encryptionKeyTransportAlgorithmId: null,
		encryptionRsaModulusBits: null,
		encryptionEcCurve: null,
		encryptionCertStatus: 'not_configured' as const,
	},
	apiConnection: null,
	lastSyncStatus: null,
	lastSyncAt: null,
	auditEventsRoute: AUDIT_ROUTE_PREFIX,
	adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
};

async function mockAuthenticatedAdmin(page: import('@playwright/test').Page) {
	await page.route('**/api/admin/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				admin: { id: '1', username: 'admin' },
				csrfToken: 'test-csrf',
			}),
		});
	});
	await page.route('**/api/admin', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.continue();
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(dashboardStub),
		});
	});
}

test.describe('Responsive app shell (WEB-RSP Playwright)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('nestidp.locale', 'en');
		});
	});

	test('WEB-RSP-30: mobile drawer opens on burger click', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 375, height: 800 });
		await page.goto('/admin');
		await page.getByRole('button', { name: /menu/i }).click();
		await expect(page.locator('#evg-sidebar')).toHaveClass(/evg-sidebar--open/);
	});

	test('WEB-RSP-31: mobile drawer open screenshot baseline', async ({ page }) => {
		test.skip(!!process.env.CI, 'PNG baselines are updated on developer machines, not in CI');
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 375, height: 800 });
		await page.goto('/admin');
		await page.getByRole('button', { name: /menu/i }).click();
		await expect(page.locator('#evg-sidebar')).toHaveClass(/evg-sidebar--open/);
		await expect(page).toHaveScreenshot('admin-shell-375-drawer-open.png', { fullPage: true });
	});

	test('WEB-RSP-32: desktop hides mobile nav toggle', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin');
		await expect(page.getByTestId('evg-mobile-nav-toggle')).toBeHidden();
	});

	test('WEB-RSP-33: desktop sidebar stays fixed while main scrolls', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/settings/idp');
		await page.route('**/api/admin/idp/settings', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					entityId: 'http://localhost:3000',
					nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
					hasSigningCertificate: true,
					signingCertFingerprintSha256: 'aa:bb:cc',
					signingCertNotAfter: '2030-01-01T00:00:00.000Z',
					signingKeyFamily: 'rsa',
					signingSignatureAlgorithmId: 'rsa-sha256',
					signingRsaModulusBits: 2048,
					signingEcCurve: null,
					metadataUrl: 'http://localhost:3000/saml/metadata',
					ssoUrl: 'http://localhost:3000/saml/sso',
					idpBaseUrl: 'http://localhost:3000',
					rotation: {
						active: false,
						startedAt: null,
						hasPendingCertificate: false,
						pendingCertFingerprintSha256: null,
					},
					hasEncryptionCertificate: false,
					encryptionCertFingerprintSha256: null,
					encryptionCertNotAfter: null,
					encryptionKeyFamily: null,
					encryptionKeyTransportAlgorithmId: null,
					encryptionRsaModulusBits: null,
					encryptionEcCurve: null,
					encryptionRotation: {
						active: false,
						startedAt: null,
						hasPendingCertificate: false,
						pendingCertFingerprintSha256: null,
					},
					updatedAt: '2026-01-01T00:00:00.000Z',
				}),
			});
		});
		const sidebar = page.locator('#evg-sidebar');
		const main = page.locator('#evg-main');
		const before = await sidebar.boundingBox();
		await main.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		const after = await sidebar.boundingBox();
		expect(before).not.toBeNull();
		expect(after).not.toBeNull();
		expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThanOrEqual(2);
	});

	test('WEB-RSP-34: 769px viewport hides burger and shows sidebar', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 769, height: 800 });
		await page.goto('/admin');
		await expect(page.getByTestId('evg-mobile-nav-toggle')).toBeHidden();
		const box = await page.locator('#evg-sidebar').boundingBox();
		expect(box).not.toBeNull();
		expect(box?.width ?? 0).toBeGreaterThan(100);
	});
});
