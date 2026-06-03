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
	},
	apiConnection: null,
	lastSyncStatus: null,
	lastSyncAt: null,
	auditEventsRoute: AUDIT_ROUTE_PREFIX,
	adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
};

async function mockUnauthenticatedAdmin(page: import('@playwright/test').Page) {
	await page.route('**/api/admin/auth/me', async (route) => {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
		});
	});
}

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

test.describe('Evergreen visual baselines', () => {
	test('admin login mobile 375×667', async ({ page }) => {
		await mockUnauthenticatedAdmin(page);
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/admin/login');
		await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
		await expect(page).toHaveScreenshot('admin-login-375.png', { fullPage: true });
	});

	test('admin login desktop 1280×720', async ({ page }) => {
		await mockUnauthenticatedAdmin(page);
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/login');
		await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
		await expect(page).toHaveScreenshot('admin-login-1280.png', { fullPage: true });
	});

	test('dashboard mobile 375×667', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await expect(page).toHaveScreenshot('dashboard-375.png', { fullPage: true });
	});

	test('dashboard desktop 1280×720', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await expect(page).toHaveScreenshot('dashboard-1280.png', { fullPage: true });
	});

	test('api connection form desktop 1280×720', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
		await page.route('**/api/admin/api-connections', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ connections: [] }),
				});
				return;
			}
			await route.continue();
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/api-connections/new');
		await expect(page.getByRole('heading', { name: 'New API connection' })).toBeVisible();
		await expect(page.locator('input[name="name"]')).toBeVisible();
		await expect(page).toHaveScreenshot('api-connection-form-1280.png', { fullPage: true });
	});

	test('idp settings desktop 1280×720', async ({ page }) => {
		await mockAuthenticatedAdmin(page);
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
					metadataUrl: 'http://localhost:3000/saml/metadata',
					ssoUrl: 'http://localhost:3000/saml/sso',
					idpBaseUrl: 'http://localhost:3000',
					rotation: {
						active: false,
						startedAt: null,
						hasPendingCertificate: false,
						pendingCertFingerprintSha256: null,
					},
					updatedAt: '2026-01-01T00:00:00.000Z',
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/settings/idp');
		await expect(page.getByRole('heading', { name: 'IdP settings' })).toBeVisible();
		await expect(page).toHaveScreenshot('idp-settings-1280.png', { fullPage: true });
	});

	test('identity users list desktop 1280×720', async ({ page }) => {
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
		await page.route('**/api/admin/identity/users**', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'u1',
							username: 'alice',
							email: 'alice@example.com',
							displayName: 'Alice',
							externalId: 'manual:user:u1',
							apiConnectionId: 'loc',
							origin: 'manual',
							active: true,
						},
					],
					total: 1,
				}),
			});
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/identity/users');
		await expect(page.locator('h2.evg-page-header__title')).toHaveText('Users');
		await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
		await expect(page).toHaveScreenshot('identity-users-list-1280.png', { fullPage: true });
	});
});
