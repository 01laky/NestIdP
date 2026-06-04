import { createContext, useContext } from 'react';

export interface ShellUiContextValue {
	closeMobileNav: () => void;
}

export const ShellUiContext = createContext<ShellUiContextValue | null>(null);

export function useShellUi(): ShellUiContextValue {
	const ctx = useContext(ShellUiContext);
	return ctx ?? { closeMobileNav: () => {} };
}
