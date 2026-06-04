import { test, expect } from '@playwright/test';

const usernameField = (page: import('@playwright/test').Page) =>
	page.getByRole('textbox', { name: /^Username/i });

/** Post-login admin app URL — must not match /admin/login. */
async function waitForAdminApp(page: import('@playwright/test').Page) {
	await page.waitForURL((url) => {
		const path = new URL(url).pathname;
		return path === '/admin' || (path.startsWith('/admin/') && !path.startsWith('/admin/login'));
	});
}

test.describe('Admin login remember (WEB-ADM-E2E-RM)', () => {
	test.beforeEach(async ({ page }) => {
		// Do not clear localStorage here — addInitScript runs on every navigation and would
		// wipe remembered username when tests visit multiple routes (WEB-ADM-E2E-RM-05).
		await page.addInitScript(() => {
			localStorage.setItem('nestidp.locale', 'en');
		});
		await page.route('**/api/admin/auth/me', async (route) => {
			await route.fulfill({ status: 401, body: '{}' });
		});
	});

	test('WEB-ADM-E2E-RM-01: remember username prefills after reload', async ({ page }) => {
		await page.goto('/admin/login');
		await page.evaluate(() => localStorage.clear());

		await page.route('**/api/admin/auth/login', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ok: true,
					admin: { id: '1', username: 'operator' },
					csrfToken: 'csrf',
				}),
			});
		});
		await page.reload();
		await page.getByRole('checkbox', { name: /Remember username/i }).check();
		await usernameField(page).fill('operator');
		await page.getByLabel(/^Password/i).fill('secret');
		await page.getByRole('button', { name: /Sign in/i }).click();
		await waitForAdminApp(page);
		await page.goto('/admin/login');
		await expect(usernameField(page)).toHaveValue('operator');
		await expect(page.getByRole('checkbox', { name: /Remember username/i })).toBeChecked();
	});

	test('WEB-ADM-E2E-RM-02: stay signed in sends rememberMe true', async ({ page }) => {
		await page.goto('/admin/login');
		await page.evaluate(() => localStorage.clear());

		let loginBody: { rememberMe?: boolean } = {};
		await page.route('**/api/admin/auth/login', async (route) => {
			loginBody = route.request().postDataJSON() as { rememberMe?: boolean };
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ok: true,
					admin: { id: '1', username: 'admin' },
					csrfToken: 'csrf',
				}),
			});
		});
		await page.reload();
		await page.getByRole('checkbox', { name: /Stay signed in/i }).check();
		await usernameField(page).fill('admin');
		await page.getByLabel(/^Password/i).fill('secret');
		await page.getByRole('button', { name: /Sign in/i }).click();
		await expect.poll(() => loginBody.rememberMe).toBe(true);
	});

	test('WEB-ADM-E2E-RM-03: session_expired query shows message', async ({ page }) => {
		await page.goto('/admin/login?reason=session_expired');
		await expect(page.getByText(/session has expired/i)).toBeVisible();
	});

	test('WEB-ADM-E2E-RM-04: shared computer warning when stay signed in checked', async ({
		page,
	}) => {
		await page.goto('/admin/login');
		await page.getByRole('checkbox', { name: /Stay signed in/i }).check();
		await expect(page.getByText(/shared or public computers/i)).toBeVisible();
	});

	test('WEB-ADM-E2E-RM-05: remembered username survives navigation away from admin', async ({
		page,
	}) => {
		await page.goto('/admin/login');
		await page.evaluate(() => localStorage.clear());

		await page.route('**/api/admin/auth/login', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ok: true,
					admin: { id: '1', username: 'persisted' },
					csrfToken: 'csrf',
				}),
			});
		});
		await page.reload();
		await page.getByRole('checkbox', { name: /Remember username/i }).check();
		await usernameField(page).fill('persisted');
		await page.getByLabel(/^Password/i).fill('secret');
		await page.getByRole('button', { name: /Sign in/i }).click();
		await waitForAdminApp(page);
		await page.goto('/login');
		await page.goto('/admin/login');
		await expect(usernameField(page)).toHaveValue('persisted');
	});
});
