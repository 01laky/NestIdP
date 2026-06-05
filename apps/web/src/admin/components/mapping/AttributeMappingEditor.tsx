import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpAttributeMappingConfig } from '@nestidp/shared';
import { Fieldset, Select, TextArea } from '../../../ui';
import { resolveI18nKey } from '../../../i18n/api-error-messages';
import { spPresetLabel } from '../../../i18n/enum-labels';
import { SP_ATTRIBUTE_MAPPING_PRESETS } from './constants';

type AttributeMappingEditorProps = {
	value: SpAttributeMappingConfig | null;
	onChange: (value: SpAttributeMappingConfig | null) => void;
	disabled?: boolean;
};

export function AttributeMappingEditor({ value, onChange, disabled }: AttributeMappingEditorProps) {
	const { t } = useTranslation('spConnections');
	const { t: tCommon } = useTranslation('common');
	const mapping = value ?? {};
	const [presetKey, setPresetKey] = useState('');

	function updateMapping(next: SpAttributeMappingConfig) {
		onChange(Object.keys(next).length === 0 ? null : next);
	}

	return (
		<Fieldset legend={t('attributeMapping')} disabled={disabled}>
			<Select
				label={t('preset')}
				id="mapping-preset"
				value={presetKey}
				onChange={(event) => {
					const next = event.target.value;
					setPresetKey(next);
					const preset = SP_ATTRIBUTE_MAPPING_PRESETS.find((p) => p.id === next);
					if (preset) {
						updateMapping(preset.mapping);
					}
				}}
			>
				<option value="">{t('choosePreset')}</option>
				{SP_ATTRIBUTE_MAPPING_PRESETS.map((preset) => (
					<option key={preset.id} value={preset.id}>
						{spPresetLabel(preset.id, resolveI18nKey)}
					</option>
				))}
			</Select>
			<Select
				label={t('nameIdSource')}
				value={mapping.nameId?.source ?? ''}
				onChange={(event) => {
					const source = event.target.value as 'email' | 'username' | '';
					if (!source) {
						const rest = { ...mapping };
						delete rest.nameId;
						updateMapping(rest);
						return;
					}
					updateMapping({ ...mapping, nameId: { source } });
				}}
			>
				<option value="">{tCommon('defaultOption')}</option>
				<option value="email">{t('nameIdOptionEmail')}</option>
				<option value="username">{t('nameIdOptionUsername')}</option>
			</Select>
			<TextArea
				label={t('jsonAdvanced')}
				rows={6}
				hint={t('jsonHint')}
				value={value ? JSON.stringify(value, null, 2) : ''}
				onChange={(event) => {
					const raw = event.target.value.trim();
					if (!raw) {
						onChange(null);
						return;
					}
					try {
						onChange(JSON.parse(raw) as SpAttributeMappingConfig);
					} catch {
						// keep invalid text until user fixes
					}
				}}
			/>
		</Fieldset>
	);
}
