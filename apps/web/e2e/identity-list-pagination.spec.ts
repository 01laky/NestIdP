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
	counts: { users: 25, groups: 1, roles: 1, apiConnections: 1, spConnections: 1 },
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

function mockUser(index: number) {
	return {
		id: `u${index}`,
		username: `user${String(index).padStart(3, '0')}`,
		email: `user${index}@example.com`,
		displayName: `User ${index}`,
		externalId: `ext-${index}`,
		apiConnectionId: 'loc',
		origin: 'synced' as const,
		active: true,
	};
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
		if (route.request().method() !== 'GET' || route.request().url().includes('/identity/users')) {
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

test.describe('Identity list pagination (WEB-IDN-TBL-E2E)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('nestidp.locale', 'en');
		});
	});

	test('WEB-IDN-TBL-E2E-01: users Next shows second page and range 11–20 of 25', async ({
		page,
	}) => {
		let usersCall = 0;
		await mockAuthenticatedAdmin(page);
		await page.route('**/api/admin/identity/users**', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			const url = new URL(route.request().url());
			const offset = Number(url.searchParams.get('offset') ?? '0');
			usersCall += 1;
			const items =
				offset === 0
					? Array.from({ length: 10 }, (_, i) => mockUser(i))
					: Array.from({ length: 10 }, (_, i) => mockUser(i + offset));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items, total: 25 }),
			});
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/admin/identity/users');
		const pagination = page.locator('.evg-table-pagination');
		await expect(page.getByText('user000')).toBeVisible();
		await expect(pagination.locator('.evg-table-pagination__meta')).toContainText('1–10 of 25');
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('user010')).toBeVisible();
		await expect(pagination.locator('.evg-table-pagination__meta')).toContainText('11–20 of 25');
		expect(usersCall).toBeGreaterThanOrEqual(2);
	});
});
