import { useId, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
	label: string;
	hint?: string;
	error?: string;
	requiredMark?: boolean;
	labelVisuallyHidden?: boolean;
	fieldClassName?: string;
};

export function TextInput({
	label,
	hint,
	error,
	requiredMark,
	labelVisuallyHidden,
	fieldClassName = '',
	id,
	className = '',
	...rest
}: TextInputProps) {
	const { t } = useTranslation('common');
	const generatedId = useId();
	const inputId = id ?? rest.name ?? generatedId;

	return (
		<label className={`evg-field ${fieldClassName}`.trim()} htmlFor={inputId}>
			<span className={`evg-field__label${labelVisuallyHidden ? ' evg-sr-only' : ''}`.trim()}>
				{label}
				{requiredMark ? <span className="evg-muted"> ({t('required')})</span> : null}
			</span>
			<input
				id={inputId}
				className={`evg-input ${className}`.trim()}
				aria-required={rest.required || requiredMark ? true : undefined}
				{...rest}
			/>
			{hint ? <span className="evg-field__hint">{hint}</span> : null}
			{error ? <span className="evg-field__error">{error}</span> : null}
		</label>
	);
}
