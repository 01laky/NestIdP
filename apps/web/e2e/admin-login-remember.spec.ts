import { test, expect } from '@playwright/test';

test.describe('Admin login remember (WEB-ADM-E2E-RM)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.clear();
		});
		await page.route('**/api/admin/auth/me', async (route) => {
			await route.fulfill({ status: 401, body: '{}' });
		});
	});

	test('WEB-ADM-E2E-RM-01: remember username prefills after reload', async ({ page }) => {
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
		await page.goto('/admin/login');
		await page.getByRole('checkbox', { name: /Remember username/i }).check();
		await page.getByLabel(/Username/i).fill('operator');
		await page.getByLabel(/Password/i).fill('secret');
		await page.getByRole('button', { name: /Sign in/i }).click();
		await page.waitForURL('**/admin**');
		await page.goto('/admin/login');
		await expect(page.getByLabel(/Username/i)).toHaveValue('operator');
		await expect(page.getByRole('checkbox', { name: /Remember username/i })).toBeChecked();
	});

	test('WEB-ADM-E2E-RM-02: stay signed in sends rememberMe true', async ({ page }) => {
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
		await page.goto('/admin/login');
		await page.getByRole('checkbox', { name: /Stay signed in/i }).check();
		await page.getByLabel(/Username/i).fill('admin');
		await page.getByLabel(/Password/i).fill('secret');
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
		await page.goto('/admin/login');
		await page.getByRole('checkbox', { name: /Remember username/i }).check();
		await page.getByLabel(/^Username/i).fill('persisted');
		await page.getByLabel(/^Password/i).fill('secret');
		await page.getByRole('button', { name: /Sign in/i }).click();
		await page.waitForURL('**/admin**');
		await page.goto('/login');
		await page.goto('/admin/login');
		await expect(page.getByLabel(/^Username/i)).toHaveValue('persisted');
	});
});
