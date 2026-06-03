import type { InputHTMLAttributes } from 'react';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
	label: string;
	hint?: string;
	error?: string;
	requiredMark?: boolean;
};

export function TextInput({
	label,
	hint,
	error,
	requiredMark,
	id,
	className = '',
	...rest
}: TextInputProps) {
	const inputId = id ?? rest.name ?? label.replace(/\s+/g, '-').toLowerCase();

	return (
		<label className="evg-field" htmlFor={inputId}>
			<span className="evg-field__label">
				{label}
				{requiredMark ? <span className="evg-muted"> (required)</span> : null}
			</span>
			<input id={inputId} className={`evg-input ${className}`.trim()} {...rest} />
			{hint ? <span className="evg-field__hint">{hint}</span> : null}
			{error ? <span className="evg-field__error">{error}</span> : null}
		</label>
	);
}
