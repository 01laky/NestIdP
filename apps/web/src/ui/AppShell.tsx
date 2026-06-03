import { useEffect, useState, type ReactNode } from 'react';
import { SidebarNav } from './SidebarNav';
import { MobileNavToggle } from './MobileNavToggle';
import { OperatorSessionBar } from './OperatorSessionBar';

export function AppShell({
	children,
	operatorUsername,
	onLogout,
}: {
	children: ReactNode;
	operatorUsername: string | null;
	onLogout: () => void;
}) {
	const [drawerOpen, setDrawerOpen] = useState(false);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setDrawerOpen(false);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<div className="evg-shell evg-shell--with-sidebar">
			<a href="#evg-main" className="evg-skip-link">
				Skip to content
			</a>
			{drawerOpen ? (
				<button
					type="button"
					className="evg-drawer-scrim"
					aria-label="Close menu"
					onClick={() => setDrawerOpen(false)}
				/>
			) : null}
			<aside
				id="evg-sidebar"
				data-testid="evg-sidebar"
				className={`evg-sidebar${drawerOpen ? ' evg-sidebar--open' : ''}`}
			>
				<SidebarNav
					operatorUsername={operatorUsername}
					onLogout={onLogout}
					onNavigate={() => setDrawerOpen(false)}
				/>
			</aside>
			<div>
				<header className="evg-topbar">
					<MobileNavToggle expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
					{operatorUsername ? (
						<OperatorSessionBar username={operatorUsername} />
					) : (
						<span className="evg-muted">Operator console</span>
					)}
				</header>
				<main id="evg-main" className="evg-main">
					<div className="evg-container">{children}</div>
				</main>
			</div>
		</div>
	);
}
