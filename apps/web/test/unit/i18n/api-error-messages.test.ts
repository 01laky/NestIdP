import { afterEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n/i18n';
import { formatAdminApiError, formatAuthApiError, resolveI18nKey } from '@/i18n/api-error-messages';

afterEach(async () => {
	await initI18n('en');
});

describe('api-error-messages (WEB-I18N-53–64)', () => {
	it('WEB-I18N-53: managed_by_sync slug maps in en', async () => {
		await initI18n('en');
		expect(formatAdminApiError(400, 'managed_by_sync', resolveI18nKey)).toBe(
			'This record is managed by identity sync.',
		);
	});

	it('WEB-I18N-54: managed_by_sync slug maps in cs', async () => {
		await initI18n('cs');
		const out = formatAdminApiError(400, 'managed_by_sync', resolveI18nKey);
		expect(out).toContain('synchronizac');
	});

	it('WEB-I18N-55: Invalid credentials → errors.invalidCredentials', async () => {
		await initI18n('en');
		expect(formatAdminApiError(401, 'Invalid credentials', resolveI18nKey)).toBe(
			'Invalid credentials',
		);
	});

	it('WEB-I18N-56: 401 with empty message uses unauthorized key', async () => {
		await initI18n('en');
		expect(formatAdminApiError(401, '', resolveI18nKey)).toBe('Unauthorized');
	});

	it('WEB-I18N-57: unknown API message passed through', async () => {
		await initI18n('en');
		expect(formatAdminApiError(500, 'Custom server detail', resolveI18nKey)).toBe(
			'Custom server detail',
		);
	});

	it('WEB-I18N-58: empty message uses fallbackKey', async () => {
		await initI18n('en');
		expect(formatAdminApiError(500, '', resolveI18nKey, 'errors.saveFailed')).toBe('Save failed');
	});

	it('WEB-I18N-59: Sync already in progress slug', async () => {
		await initI18n('en');
		expect(formatAdminApiError(409, 'Sync already in progress', resolveI18nKey)).toBe(
			'Sync already in progress',
		);
	});

	it('WEB-I18N-60: formatAuthApiError maps slug and empty to signInFailed', async () => {
		await initI18n('en');
		expect(formatAuthApiError('Invalid credentials', resolveI18nKey)).toBe('Invalid credentials');
		expect(formatAuthApiError('', resolveI18nKey)).toBe('Sign in failed. Please try again.');
	});

	it('WEB-I18N-61: formatAuthApiError cs invalid credentials', async () => {
		await initI18n('cs');
		const out = formatAuthApiError('Invalid credentials', resolveI18nKey);
		expect(out).not.toBe('Invalid credentials');
		expect(out.length).toBeGreaterThan(3);
	});

	it('WEB-I18N-62: resolveI18nKey with namespace prefix', async () => {
		await initI18n('en');
		expect(resolveI18nKey('common.apply')).toBe('Apply');
	});

	it('WEB-I18N-63: resolveI18nKey identity namespace', async () => {
		await initI18n('pl');
		expect(resolveI18nKey('identity.usersTitle')).toBe('Użytkownicy');
	});

	it('WEB-I18N-64: 429 uses unauthorized when message blank', async () => {
		await initI18n('en');
		expect(formatAdminApiError(429, '   ', resolveI18nKey)).toBe('Unauthorized');
	});
});
