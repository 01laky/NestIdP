import { test, expect } from '@playwright/test';

const idpSettings = {
	entityId: 'http://localhost:3000',
	nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
	hasSigningCertificate: true,
	signingCertFingerprintSha256: 'aa:bb',
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
};

/** Signing panel is first; encryption also exposes "Generate certificate". */
function signingGenerateButton(page: import('@playwright/test').Page) {
	return page.getByRole('button', { name: 'Generate certificate' }).first();
}

const apiConnectionBody = {
	connection: {
		id: 'c1',
		name: 'HR API',
		baseUrl: 'https://api.example.com',
		authType: 'BEARER',
		hasBearerToken: true,
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	},
};

/** Matches adminApi generateIdpSigningCert path under IDP_SETTINGS_API_PATH. */
const GENERATE_CERT_ROUTE = '**/api/admin/idp/settings/signing-cert/generate';

test.describe('Admin confirm dialog (WEB-ADM-E2E-CONF)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('nestidp.locale', 'en');
		});
		page.on('dialog', () => {
			throw new Error('Native window.confirm/alert must not be used in admin');
		});
		await page.route('**/api/admin/auth/me', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					admin: { id: '1', username: 'admin' },
					csrfToken: 'csrf',
				}),
			});
		});
		await page.route('**/api/admin/idp/settings', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(idpSettings),
				});
				return;
			}
			await route.continue();
		});
	});

	test('WEB-ADM-E2E-CONF-01: generate cert modal cancel skips POST', async ({ page }) => {
		let generateCalled = false;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			generateCalled = true;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(generateCalled).toBe(false);
	});

	test('WEB-ADM-E2E-CONF-02: modal fits mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		const box = await dialog.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeLessThanOrEqual(390);
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
	});

	test('E2E-IDP-CRYPTO-02: select EC and POST generate sends ec body', async ({ page }) => {
		let postedBody: Record<string, unknown> | null = null;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			postedBody = route.request().postDataJSON() as Record<string, unknown>;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await page.getByLabel('Key type').selectOption('ec');
		await page.getByLabel('EC curve').selectOption('P-384');
		await page.getByLabel('Signature algorithm').selectOption('ecdsa-sha384');
		await signingGenerateButton(page).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('textbox').fill('REPLACE');
		await dialog.getByRole('button', { name: 'Generate certificate' }).click();
		await expect.poll(() => postedBody).not.toBeNull();
		expect(postedBody!.keyFamily).toBe('ec');
		expect(postedBody!.ecCurve).toBe('P-384');
		expect(postedBody!.signatureAlgorithmId).toBe('ecdsa-sha384');
	});

	test('E2E-IDP-CRYPTO-01: POST generate captures JSON body with defaults', async ({ page }) => {
		let postedBody: Record<string, unknown> | null = null;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			postedBody = route.request().postDataJSON() as Record<string, unknown>;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('textbox').fill('REPLACE');
		await dialog.getByRole('button', { name: 'Generate certificate' }).click();
		await expect.poll(() => postedBody).not.toBeNull();
		expect(postedBody!.keyFamily).toBe('rsa');
		expect(postedBody!.rsaModulusBits).toBe(2048);
		expect(postedBody!.signatureAlgorithmId).toBe('rsa-sha256');
		expect(String(postedBody!.notAfter)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test('WEB-ADM-E2E-CONF-03: REPLACE required then POST generate', async ({ page }) => {
		let generateCalled = false;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			generateCalled = true;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		const dialog = page.getByRole('dialog');
		const confirmBtn = dialog.getByRole('button', { name: 'Generate certificate' });
		await expect(confirmBtn).toBeDisabled();
		await dialog.getByRole('textbox').fill('REPLACE');
		await expect(confirmBtn).toBeEnabled();
		await confirmBtn.click();
		await expect.poll(() => generateCalled).toBe(true);
	});

	test('WEB-ADM-E2E-CONF-04: no native dialog event (guard)', async ({ page }) => {
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('WEB-ADM-E2E-CONF-06: Escape closes generate modal without POST', async ({ page }) => {
		let generateCalled = false;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			generateCalled = true;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(generateCalled).toBe(false);
	});

	test('WEB-ADM-E2E-CONF-07: wrong REPLACE text keeps generate disabled', async ({ page }) => {
		let generateCalled = false;
		await page.route(GENERATE_CERT_ROUTE, async (route) => {
			generateCalled = true;
			await route.fulfill({ status: 200, body: JSON.stringify(idpSettings) });
		});
		await page.goto('/admin/settings/idp');
		await signingGenerateButton(page).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('textbox').fill('replace');
		const confirmBtn = dialog.getByRole('button', { name: 'Generate certificate' });
		await expect(confirmBtn).toBeDisabled();
		await confirmBtn.click({ force: true });
		expect(generateCalled).toBe(false);
	});

	test('WEB-ADM-E2E-CONF-08: full sync modal cancel skips sync POST', async ({ page }) => {
		let syncCalled = false;
		await page.route('**/api/admin/api-connections/c1', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(apiConnectionBody),
				});
				return;
			}
			await route.continue();
		});
		await page.route('**/api/admin/sync/c1/status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					connectionId: 'c1',
					lastSyncStatus: 'NEVER',
					lastSyncAt: null,
					syncInProgress: false,
					latestSyncLog: null,
				}),
			});
		});
		await page.route('**/api/admin/sync/c1/logs*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ syncLogs: [] }),
			});
		});
		await page.route('**/api/admin/sync/c1', async (route) => {
			if (route.request().method() === 'POST') {
				syncCalled = true;
			}
			await route.fulfill({ status: 200, body: '{}' });
		});
		await page.goto('/admin/api-connections/c1/sync');
		await page.getByRole('button', { name: 'Run full sync' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(syncCalled).toBe(false);
	});

	test('WEB-ADM-E2E-CONF-05: mobile nav closes before delete modal', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.route('**/api/admin/api-connections/c1', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(apiConnectionBody),
				});
				return;
			}
			await route.continue();
		});
		await page.goto('/admin/api-connections/c1');
		const deleteBtn = page.locator('#evg-main button.evg-btn--danger');
		await expect(deleteBtn).toHaveText('Delete', { timeout: 15_000 });
		await page.getByRole('button', { name: 'Menu' }).click();
		await expect(page.locator('#evg-sidebar.evg-sidebar--open')).toBeVisible();
		// Inert #evg-main is removed from the a11y tree while the drawer is open; use DOM click.
		await deleteBtn.evaluate((el) => (el as HTMLButtonElement).click());
		await expect(page.locator('#evg-sidebar.evg-sidebar--open')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toBeVisible();
	});
});
