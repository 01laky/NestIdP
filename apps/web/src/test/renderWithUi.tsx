import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from '../ui';

export function renderWithUi(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
	function Wrapper({ children }: { children: ReactNode }) {
		return <ToastProvider>{children}</ToastProvider>;
	}
	return render(ui, { wrapper: Wrapper, ...options });
}
