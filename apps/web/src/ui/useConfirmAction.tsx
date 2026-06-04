import { useCallback } from 'react';
import type { ConfirmActionOptions } from './confirm-types';
import { useConfirm } from './useConfirm';

export function useConfirmAction() {
	const confirm = useConfirm();

	return useCallback(
		async (options: ConfirmActionOptions): Promise<boolean> => {
			const { onConfirm, ...confirmOptions } = options;
			const ok = await confirm(confirmOptions);
			if (!ok) {
				return false;
			}
			await onConfirm();
			return true;
		},
		[confirm],
	);
}
