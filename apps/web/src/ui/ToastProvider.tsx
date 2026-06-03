import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import { Toast } from './Toast';

type ToastItem = { id: number; message: string };

type ToastContextValue = {
	showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([]);

	const dismiss = useCallback((id: number) => {
		setToasts((current) => current.filter((t) => t.id !== id));
	}, []);

	const showToast = useCallback((message: string) => {
		const id = Date.now() + Math.random();
		setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, message }]);
	}, []);

	useEffect(() => {
		if (toasts.length === 0) {
			return;
		}
		const timers = toasts.map((toast) =>
			window.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS),
		);
		return () => {
			for (const timer of timers) {
				window.clearTimeout(timer);
			}
		};
	}, [toasts, dismiss]);

	const value = useMemo(() => ({ showToast }), [showToast]);

	return (
		<ToastContext.Provider value={value}>
			{children}
			<div className="evg-toast-region" aria-live="polite">
				{toasts.map((toast) => (
					<Toast key={toast.id} message={toast.message} onDismiss={() => dismiss(toast.id)} />
				))}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext);
	if (!ctx) {
		throw new Error('useToast must be used within ToastProvider');
	}
	return ctx;
}
