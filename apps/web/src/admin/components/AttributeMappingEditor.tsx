import type { SpAttributeMappingConfig } from '@nestidp/shared';
import { SP_ATTRIBUTE_MAPPING_PRESETS } from './sp-mapping-presets';

type AttributeMappingEditorProps = {
	value: SpAttributeMappingConfig | null;
	onChange: (value: SpAttributeMappingConfig | null) => void;
};

export function AttributeMappingEditor({ value, onChange }: AttributeMappingEditorProps) {
	const mapping = value ?? {};

	function updateMapping(next: SpAttributeMappingConfig) {
		onChange(Object.keys(next).length === 0 ? null : next);
	}

	return (
		<fieldset className="evg-fieldset">
			<legend>Attribute mapping</legend>
			<div className="evg-code-blockset-row">
				<label htmlFor="mapping-preset">Preset</label>
				<select
					id="mapping-preset"
					defaultValue=""
					onChange={(event) => {
						const preset = SP_ATTRIBUTE_MAPPING_PRESETS.find((p) => p.id === event.target.value);
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
				</select>
			</div>
			<label>
				NameID source
				<select
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
				</select>
			</label>
			<label>
				JSON (advanced)
				<textarea
					rows={6}
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
			</label>
		</fieldset>
	);
}
