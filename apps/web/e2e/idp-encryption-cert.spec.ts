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
	hasEncryptionCertificate: false,
	encryptionCertFingerprintSha256: null,
	encryptionCertNotAfter: null,
	encryptionKeyFamily: null,
	encryptionKeyTransportAlgorithmId: null,
	encryptionRsaModulusBits: null,
	encryptionEcCurve: null,
	metadataUrl: 'http://localhost:3000/saml/metadata',
	ssoUrl: 'http://localhost:3000/saml/sso',
	idpBaseUrl: 'http://localhost:3000',
	rotation: {
		active: false,
		startedAt: null,
		hasPendingCertificate: false,
		pendingCertFingerprintSha256: null,
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		pendingSigningCertNotAfter: null,
	},
	encryptionRotation: {
		active: false,
		startedAt: null,
		hasPendingCertificate: false,
		pendingCertFingerprintSha256: null,
		pendingEncryptionKeyFamily: null,
		pendingEncryptionKeyTransportAlgorithmId: null,
		pendingEncryptionRsaModulusBits: null,
		pendingEncryptionEcCurve: null,
		pendingEncryptionCertNotAfter: null,
	},
	updatedAt: '2026-01-01T00:00:00.000Z',
};

const GENERATE_ENCRYPTION_ROUTE = '**/api/admin/idp/settings/encryption-cert/generate';

test.describe('IdP encryption certificate (E2E-IDP-ENC)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('nestidp.locale', 'en');
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
		await page.route('**/api/admin/idp/settings/metadata-preview', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/xml',
				body: '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"/>',
			});
		});
	});

	test('E2E-IDP-ENC-01: POST encryption generate captures JSON body with defaults', async ({
		page,
	}) => {
		let postedBody: Record<string, unknown> | null = null;
		await page.route(GENERATE_ENCRYPTION_ROUTE, async (route) => {
			postedBody = route.request().postDataJSON() as Record<string, unknown>;
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({
					...idpSettings,
					hasEncryptionCertificate: true,
					encryptionKeyFamily: 'rsa',
					encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
					encryptionRsaModulusBits: 2048,
				}),
			});
		});
		await page.goto('/admin/settings/idp');
		const section = page.getByRole('heading', { name: 'Encryption certificate' }).locator('..');
		await section.getByRole('button', { name: 'Generate certificate' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'Generate' }).click();
		expect(postedBody).not.toBeNull();
		expect(postedBody!.keyFamily ?? 'rsa').toBe('rsa');
		expect(postedBody!.keyTransportAlgorithmId ?? 'rsa-oaep-mgf1p').toBe('rsa-oaep-mgf1p');
	});

	test('E2E-IDP-ENC-02: encryption rotation complete flow with mocks', async ({ page }) => {
		let completeCalled = false;
		await page.route('**/api/admin/idp/settings/encryption-cert/rotation/start', async (route) => {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({
					...idpSettings,
					hasEncryptionCertificate: true,
					encryptionRotation: {
						...idpSettings.encryptionRotation,
						active: true,
						hasPendingCertificate: true,
					},
				}),
			});
		});
		await page.route(
			'**/api/admin/idp/settings/encryption-cert/rotation/complete',
			async (route) => {
				completeCalled = true;
				await route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({
						...idpSettings,
						hasEncryptionCertificate: true,
						encryptionRotation: { ...idpSettings.encryptionRotation, active: false },
					}),
				});
			},
		);
		await page.goto('/admin/settings/idp');
		const section = page.getByRole('heading', { name: 'Encryption certificate' }).locator('..');
		await section.getByRole('button', { name: 'Start encryption rotation (generate)' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'Start encryption rotation (generate)' }).click();
		await expect.poll(() => completeCalled).toBe(false);
		await section.getByRole('button', { name: 'Complete rotation' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('textbox').fill('COMPLETE');
		await page.getByRole('button', { name: 'Complete rotation' }).click();
		await expect.poll(() => completeCalled).toBe(true);
	});
});
