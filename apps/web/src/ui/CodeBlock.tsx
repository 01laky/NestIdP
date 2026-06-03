import type { ReactNode } from 'react';

export function CodeBlock({ children }: { children: ReactNode }) {
	return <pre className="evg-code-block">{children}</pre>;
}
