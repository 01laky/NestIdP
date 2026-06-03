import type { AuditCategoryLiteral } from '@nestidp/shared';
import type { TFunction } from 'i18next';

export function auditCategoryLabel(category: AuditCategoryLiteral, t: TFunction): string {
	return t(`enums.auditCategory.${category}`);
}

export function identityOriginFilterLabel(value: '' | 'manual' | 'synced', t: TFunction): string {
	if (value === '') {
		return t('common.all');
	}
	return t(`enums.identityOrigin.${value}`);
}

export function spPresetLabel(presetId: string, t: TFunction): string {
	return t(`enums.spPreset.${presetId}`, { defaultValue: presetId });
}
