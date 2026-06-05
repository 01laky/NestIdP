import { beforeEach } from 'vitest';
import { initI18nForTests } from '@/i18n/I18nProvider';

beforeEach(async () => {
	await initI18nForTests('en');
});
