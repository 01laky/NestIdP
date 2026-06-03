export function Checkbox({
	label,
	checked,
	onChange,
	disabled,
	hint,
	id,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	hint?: string;
	id?: string;
}) {
	const inputId = id ?? label.replace(/\s+/g, '-').toLowerCase();

	return (
		<label className="evg-field evg-field--checkbox" htmlFor={inputId}>
			<input
				id={inputId}
				type="checkbox"
				className="evg-checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => {
					if (disabled) {
						return;
					}
					onChange(event.target.checked);
				}}
			/>
			<span className="evg-field__label">{label}</span>
			{hint ? <span className="evg-field__hint">{hint}</span> : null}
		</label>
	);
}
