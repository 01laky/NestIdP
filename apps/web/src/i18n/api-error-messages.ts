import type { TFunction } from 'i18next';
import { getI18n } from './i18n';
import { I18N_NAMESPACES, type I18nNamespace } from './namespaces';

function resolveI18nKeyImpl(key: string, options?: Record<string, unknown>): string {
	const i18n = getI18n();
	const dot = key.indexOf('.');
	if (dot > 0) {
		const ns = key.slice(0, dot);
		if (I18N_NAMESPACES.includes(ns as I18nNamespace)) {
			return i18n.t(key.slice(dot + 1), { ns: ns as I18nNamespace, ...options });
		}
	}
	return i18n.t(key, options);
}

export const resolveI18nKey = resolveI18nKeyImpl as TFunction;

const MESSAGE_KEY_BY_SLUG: Record<string, string> = {
	managed_by_sync: 'errors.managedBySync',
	'Invalid credentials': 'errors.invalidCredentials',
	Unauthorized: 'errors.unauthorized',
	'Invalid id': 'errors.invalidId',
	'Sync already in progress': 'errors.syncInProgress',
};

const STATUS_KEY: Record<number, string> = {
	401: 'errors.unauthorized',
	429: 'errors.unauthorized',
};

export function formatAdminApiError(
	statusCode: number,
	message: string,
	t: TFunction,
	fallbackKey = 'errors.loadFailed',
): string {
	const slugKey = MESSAGE_KEY_BY_SLUG[message];
	if (slugKey) {
		return t(slugKey);
	}
	const statusKey = STATUS_KEY[statusCode];
	if (statusKey && !message.trim()) {
		return t(statusKey);
	}
	if (message.trim()) {
		return message;
	}
	return t(fallbackKey);
}

export function formatAuthApiError(message: string, t: TFunction): string {
	const slugKey = MESSAGE_KEY_BY_SLUG[message];
	if (slugKey) {
		return t(slugKey);
	}
	return message || t('errors.signInFailed');
}
