import type { ReactNode } from 'react';

export function Fieldset({
	legend,
	children,
	disabled,
	className = '',
}: {
	legend: string;
	children: ReactNode;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<fieldset className={`evg-fieldset ${className}`.trim()} disabled={disabled}>
			<legend>{legend}</legend>
			{children}
		</fieldset>
	);
}
