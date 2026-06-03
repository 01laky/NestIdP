import { NavLink } from 'react-router-dom';
import {
	API_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
} from '@nestidp/shared';
import { OperatorSessionBar } from './OperatorSessionBar';
import { Button } from './Button';
import { IconSprig } from './icons';

export function SidebarNav({
	operatorUsername,
	onLogout,
	onNavigate,
}: {
	operatorUsername: string | null;
	onLogout: () => void;
	onNavigate?: () => void;
}) {
	return (
		<>
			<a href="/admin" className="evg-brand">
				<IconSprig />
				NestIdP
			</a>
			<nav className="evg-nav" aria-label="Admin">
				<NavLink
					to="/admin"
					end
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Dashboard
				</NavLink>
				<NavLink
					to={API_CONNECTION_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					API connections
				</NavLink>
				<NavLink
					to={SP_CONNECTION_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					SP connections
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/users`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Users
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/groups`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Groups
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/roles`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Roles
				</NavLink>
				<NavLink
					to={IDP_SETTINGS_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					IdP Settings
				</NavLink>
				<NavLink
					to={ADMIN_USERS_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Admin accounts
				</NavLink>
				<NavLink
					to={AUDIT_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					Audit log
				</NavLink>
				<NavLink to="/login" className="evg-nav__link" onClick={onNavigate}>
					SAML login
				</NavLink>
			</nav>
			<div className="evg-sidebar-footer">
				{operatorUsername ? (
					<OperatorSessionBar
						username={operatorUsername}
						className="evg-operator-bar--mobile-only"
					/>
				) : null}
				<Button variant="ghost" onClick={() => void onLogout()}>
					Logout
				</Button>
			</div>
		</>
	);
}
