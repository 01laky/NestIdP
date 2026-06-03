import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { evgButtonClasses } from './button-classes';
import type { ButtonVariant } from './Button';

export type ButtonLinkProps = Omit<LinkProps, 'className'> & {
	variant?: ButtonVariant;
	size?: 'default' | 'sm';
	block?: boolean;
	className?: string;
};

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
	{ variant = 'primary', size = 'default', block = false, className = '', children, ...rest },
	ref,
) {
	return (
		<Link ref={ref} className={evgButtonClasses({ variant, size, block, className })} {...rest}>
			{children}
		</Link>
	);
});
