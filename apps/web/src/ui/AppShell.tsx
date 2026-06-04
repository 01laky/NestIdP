import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarNav } from './SidebarNav';
import { MobileNavToggle } from './MobileNavToggle';
import { OperatorSessionBar } from './OperatorSessionBar';
import { ShellUiContext } from './shell-ui-context';

const DESKTOP_MQ = '(min-width: 768px)';

export function AppShell({
	children,
	operatorUsername,
	onLogout,
}: {
	children: ReactNode;
	operatorUsername: string | null;
	onLogout: () => void;
}) {
	const { t } = useTranslation('common');
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

	useEffect(() => {
		if (!drawerOpen) {
			return;
		}
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, [drawerOpen]);

	useEffect(() => {
		if (typeof window.matchMedia !== 'function') {
			return;
		}
		const mq = window.matchMedia(DESKTOP_MQ);
		const onChange = () => {
			if (mq.matches) {
				setDrawerOpen(false);
			}
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	const shellUi = useMemo(() => ({ closeMobileNav: () => setDrawerOpen(false) }), []);

	return (
		<ShellUiContext.Provider value={shellUi}>
			<div className="evg-shell evg-shell--with-sidebar">
				<a href="#evg-main" className="evg-skip-link">
					{t('skipToContent')}
				</a>
				{drawerOpen ? (
					<button
						type="button"
						className="evg-drawer-scrim"
						aria-label={t('closeMenu')}
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
				<div className="evg-shell-body">
					<header className="evg-topbar">
						<MobileNavToggle expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
						{operatorUsername ? (
							<OperatorSessionBar username={operatorUsername} />
						) : (
							<span className="evg-muted">{t('operatorConsole')}</span>
						)}
					</header>
					<main
						id="evg-main"
						className="evg-main"
						aria-hidden={drawerOpen ? true : undefined}
						{...(drawerOpen ? ({ inert: '' } as { inert: '' }) : {})}
					>
						<div className="evg-container">{children}</div>
					</main>
				</div>
			</div>
		</ShellUiContext.Provider>
	);
}
