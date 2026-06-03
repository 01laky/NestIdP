import type { ButtonVariant } from './Button';

export function evgButtonClasses(options: {
	variant?: ButtonVariant;
	size?: 'default' | 'sm';
	block?: boolean;
	className?: string;
}): string {
	const { variant = 'primary', size = 'default', block = false, className = '' } = options;
	return [
		'evg-btn',
		`evg-btn--${variant}`,
		size === 'sm' ? 'evg-btn--sm' : '',
		block ? 'evg-btn--block' : '',
		className,
	]
		.filter(Boolean)
		.join(' ');
}
