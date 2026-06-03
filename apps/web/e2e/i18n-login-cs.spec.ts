import { expect, test } from '@playwright/test';

test('WEB-I18N-37: Czech login page lang and heading', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.removeItem('nestidp.locale');
		Object.defineProperty(navigator, 'languages', { value: ['cs-CZ'], configurable: true });
		Object.defineProperty(navigator, 'language', { value: 'cs-CZ', configurable: true });
	});
	await page.goto('/login');
	await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
	await expect(page.getByRole('heading', { name: 'SAML přihlášení' })).toBeVisible();
});
