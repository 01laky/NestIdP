import { createContext, useContext } from 'react';
import type { ConfirmOptions } from './confirm-types';

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
	const confirmFn = useContext(ConfirmContext);
	if (!confirmFn) {
		throw new Error('useConfirm must be used within ConfirmProvider');
	}
	return confirmFn;
}
