import type { TFunction } from 'i18next';
import { AdminApiError } from '../admin/adminApi';
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

/**
 * Collapses the `err instanceof AdminApiError ? formatAdminApiError(err.statusCode, err.message,
 * resolveI18nKey, key) : t(localKey)` ladder that was copy-pasted across ~50 admin catch blocks
 * (Prompt 38 §A16 / §6.9). `fallbackKey` is the fully-qualified i18n key (e.g. `'dashboard.loadFailed'`);
 * both branches resolve through `resolveI18nKey`, so a non-AdminApiError degrades to the same translated
 * fallback the inline `t(localKey)` produced.
 */
export function mapAdminError(err: unknown, fallbackKey: string): string {
	if (err instanceof AdminApiError) {
		return formatAdminApiError(err.statusCode, err.message, resolveI18nKey, fallbackKey);
	}
	return resolveI18nKey(fallbackKey);
}

export function formatAuthApiError(message: string, t: TFunction): string {
	const slugKey = MESSAGE_KEY_BY_SLUG[message];
	if (slugKey) {
		return t(slugKey);
	}
	return message || t('errors.signInFailed');
}
