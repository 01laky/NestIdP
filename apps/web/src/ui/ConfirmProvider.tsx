import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmOptions } from './confirm-types';
import { useShellUi } from './shell-ui-context';
import { ConfirmContext } from './useConfirm';

type ActiveConfirm = ConfirmOptions & {
	resolve: (value: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const { t } = useTranslation('common');
	const { closeMobileNav } = useShellUi();
	const [active, setActive] = useState<ActiveConfirm | null>(null);
	const openRef = useRef(false);
	const triggerRef = useRef<HTMLElement | null>(null);

	const close = useCallback((result: boolean) => {
		setActive((current) => {
			if (current) {
				current.resolve(result);
			}
			return null;
		});
		openRef.current = false;
		const restore = triggerRef.current;
		triggerRef.current = null;
		if (restore && typeof restore.focus === 'function') {
			window.setTimeout(() => restore.focus(), 0);
		}
	}, []);

	const confirm = useCallback(
		(options: ConfirmOptions): Promise<boolean> => {
			if (openRef.current) {
				return Promise.resolve(false);
			}
			closeMobileNav();
			const el = document.activeElement;
			triggerRef.current = el instanceof HTMLElement ? el : null;
			openRef.current = true;
			return new Promise<boolean>((resolve) => {
				setActive({ ...options, resolve });
			});
		},
		[closeMobileNav],
	);

	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			{active ? (
				<ConfirmDialog
					open
					title={active.title}
					description={active.description}
					detail={active.detail}
					confirmLabel={active.confirmLabel ?? t('confirm')}
					cancelLabel={active.cancelLabel ?? t('cancel')}
					tone={active.tone ?? 'default'}
					showAuditNote={active.showAuditNote ?? false}
					typeToConfirm={active.typeToConfirm}
					onConfirm={() => close(true)}
					onCancel={() => close(false)}
				/>
			) : null}
		</ConfirmContext.Provider>
	);
}
