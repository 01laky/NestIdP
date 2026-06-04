import type { ReactNode } from 'react';

export type ConfirmTone = 'default' | 'danger' | 'warning';

export interface TypeToConfirmOptions {
	challenge: string;
	label: string;
}

export interface ConfirmOptions {
	title: string;
	description: string;
	detail?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: ConfirmTone;
	showAuditNote?: boolean;
	typeToConfirm?: TypeToConfirmOptions;
}

export interface ConfirmActionOptions extends ConfirmOptions {
	onConfirm: () => void | Promise<void>;
}
