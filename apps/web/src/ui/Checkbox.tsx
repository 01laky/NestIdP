import { useId } from 'react';

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
	// Fall back to a guaranteed-unique id (like TextInput) rather than deriving it from the label:
	// two checkboxes sharing a label (e.g. a group and a role both named "Admins" in the membership
	// picker) would otherwise collide on id/htmlFor and clicking one would toggle the wrong input.
	const generatedId = useId();
	const inputId = id ?? generatedId;

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
