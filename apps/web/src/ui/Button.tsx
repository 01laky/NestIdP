import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { evgButtonClasses } from './button-classes';

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
	const classes = evgButtonClasses({ variant, size, block, className });

	return (
		<button type={type} className={classes} {...rest}>
			{children}
		</button>
	);
}
