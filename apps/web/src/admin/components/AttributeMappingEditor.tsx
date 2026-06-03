import { useState } from 'react';
import type { SpAttributeMappingConfig } from '@nestidp/shared';
import { Fieldset, Select, TextArea } from '../../ui';
import { SP_ATTRIBUTE_MAPPING_PRESETS } from './sp-mapping-presets';

type AttributeMappingEditorProps = {
	value: SpAttributeMappingConfig | null;
	onChange: (value: SpAttributeMappingConfig | null) => void;
	disabled?: boolean;
};

export function AttributeMappingEditor({ value, onChange, disabled }: AttributeMappingEditorProps) {
	const mapping = value ?? {};
	const [presetKey, setPresetKey] = useState('');

	function updateMapping(next: SpAttributeMappingConfig) {
		onChange(Object.keys(next).length === 0 ? null : next);
	}

	return (
		<Fieldset legend="Attribute mapping" disabled={disabled}>
			<Select
				label="Preset"
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
				<option value="">Choose preset…</option>
				{SP_ATTRIBUTE_MAPPING_PRESETS.map((preset) => (
					<option key={preset.id} value={preset.id}>
						{preset.label}
					</option>
				))}
			</Select>
			<Select
				label="NameID source"
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
				<option value="">(default)</option>
				<option value="email">email</option>
				<option value="username">username</option>
			</Select>
			<TextArea
				label="JSON (advanced)"
				rows={6}
				hint="Optional custom mapping object; invalid JSON is ignored until fixed."
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
