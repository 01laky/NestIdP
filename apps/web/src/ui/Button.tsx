import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	size?: 'default' | 'sm';
	block?: boolean;
	children: ReactNode;
};

export function Button({
	variant = 'primary',
	size = 'default',
	block = false,
	className = '',
	children,
	type = 'button',
	...rest
}: ButtonProps) {
	const classes = [
		'evg-btn',
		`evg-btn--${variant}`,
		size === 'sm' ? 'evg-btn--sm' : '',
		block ? 'evg-btn--block' : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button type={type} className={classes} {...rest}>
			{children}
		</button>
	);
}
