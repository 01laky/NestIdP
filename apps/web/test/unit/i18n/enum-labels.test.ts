import { afterEach, describe, expect, it } from 'vitest';
import type { AuditCategoryLiteral } from '@nestidp/shared';
import { initI18n } from '@/i18n/i18n';
import { resolveI18nKey } from '@/i18n/api-error-messages';
import { auditCategoryLabel, identityOriginFilterLabel, spPresetLabel } from '@/i18n/enum-labels';

const AUDIT_CATEGORIES: AuditCategoryLiteral[] = [
	'admin_auth',
	'admin_config',
	'end_user_auth',
	'saml',
	'sync',
	'identity',
];

afterEach(async () => {
	await initI18n('en');
});

describe('enum-labels (WEB-I18N-65–74)', () => {
	it('WEB-I18N-65: all audit categories have English labels', async () => {
		await initI18n('en');
		for (const category of AUDIT_CATEGORIES) {
			const label = auditCategoryLabel(category, resolveI18nKey);
			expect(label.length).toBeGreaterThan(2);
			expect(label).not.toBe(category);
		}
	});

	it('WEB-I18N-66: audit sync category French', async () => {
		await initI18n('fr');
		expect(auditCategoryLabel('sync', resolveI18nKey)).toBe('Synchronisation');
	});

	it('WEB-I18N-67: identity origin filter all/manual/synced en', async () => {
		await initI18n('en');
		expect(identityOriginFilterLabel('', resolveI18nKey)).toBe('All');
		expect(identityOriginFilterLabel('manual', resolveI18nKey)).toBe('Manual');
		expect(identityOriginFilterLabel('synced', resolveI18nKey)).toBe('Synced');
	});

	it('WEB-I18N-68: identity origin filter German manual', async () => {
		await initI18n('de');
		expect(identityOriginFilterLabel('manual', resolveI18nKey)).toBe('Manuell');
	});

	it('WEB-I18N-69: spPresetLabel known presets', async () => {
		await initI18n('en');
		expect(spPresetLabel('email-nameid', resolveI18nKey)).toContain('Email');
		expect(spPresetLabel('username-groups', resolveI18nKey)).toContain('Username');
	});

	it('WEB-I18N-70: spPresetLabel unknown id falls back to id', async () => {
		await initI18n('en');
		expect(spPresetLabel('custom-preset', resolveI18nKey)).toBe('custom-preset');
	});

	it('WEB-I18N-71: cert status labels via resolveI18nKey in cs', async () => {
		await initI18n('cs');
		const { certStatusLabel } = await import('@/admin/status-badge');
		expect(certStatusLabel('missing')).not.toBe('No signing cert');
		expect(certStatusLabel('ok').length).toBeGreaterThan(2);
	});

	it('WEB-I18N-72: identityOriginLabel manual differs cs vs sk', async () => {
		const { identityOriginLabel } = await import('@/admin/status-badge');
		await initI18n('cs');
		const csManual = identityOriginLabel('manual');
		await initI18n('sk');
		const skManual = identityOriginLabel('manual');
		expect(csManual).not.toBe(skManual);
	});

	it('WEB-I18N-73: audit saml category not raw code in pl', async () => {
		await initI18n('pl');
		expect(auditCategoryLabel('saml', resolveI18nKey)).toBe('SAML');
	});

	it('WEB-I18N-74: origin manual Czech vs Slovak catalog strings', async () => {
		await initI18n('cs');
		expect(identityOriginFilterLabel('manual', resolveI18nKey)).toBe('Ruční');
		await initI18n('sk');
		expect(identityOriginFilterLabel('manual', resolveI18nKey)).toBe('Manuálny');
	});
});
