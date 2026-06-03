import type { TextareaHTMLAttributes } from 'react';

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
	label: string;
	hint?: string;
	error?: string;
};

export function TextArea({ label, hint, error, id, className = '', ...rest }: TextAreaProps) {
	const inputId = id ?? rest.name ?? label.replace(/\s+/g, '-').toLowerCase();

	return (
		<label className="evg-field" htmlFor={inputId}>
			<span className="evg-field__label">{label}</span>
			<textarea id={inputId} className={`evg-textarea ${className}`.trim()} {...rest} />
			{hint ? <span className="evg-field__hint">{hint}</span> : null}
			{error ? <span className="evg-field__error">{error}</span> : null}
		</label>
	);
}
