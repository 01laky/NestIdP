import type { SelectHTMLAttributes, ReactNode } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
	label: string;
	children: ReactNode;
	error?: string;
	fieldClassName?: string;
};

export function Select({
	label,
	children,
	error,
	fieldClassName = '',
	id,
	className = '',
	...rest
}: SelectProps) {
	const selectId = id ?? rest.name ?? label.replace(/\s+/g, '-').toLowerCase();

	return (
		<label className={`evg-field ${fieldClassName}`.trim()} htmlFor={selectId}>
			<span className="evg-field__label">{label}</span>
			<select id={selectId} className={`evg-select ${className}`.trim()} {...rest}>
				{children}
			</select>
			{error ? <span className="evg-field__error">{error}</span> : null}
		</label>
	);
}
