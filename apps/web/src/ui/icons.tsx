import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function IconMenu(props: IconProps) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
			<path
				d="M4 7h16M4 12h16M4 17h16"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function IconClose(props: IconProps) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
			<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}

export function IconSprig(props: IconProps) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
			<path d="M12 2C9 8 4 10 4 14a4 4 0 008 0c0-2-2-4-4-6 2 2 4 4 4 6a4 4 0 008 0c0-4-5-6-8-12z" />
		</svg>
	);
}
