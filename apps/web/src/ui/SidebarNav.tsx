import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { LanguageSelect } from './LanguageSelect';

export function SidebarNav({
	operatorUsername,
	onLogout,
	onNavigate,
}: {
	operatorUsername: string | null;
	onLogout: () => void;
	onNavigate?: () => void;
}) {
	const { t } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');

	return (
		<>
			<a href="/admin" className="evg-brand">
				<IconSprig />
				{t('brand')}
			</a>
			<nav className="evg-nav" aria-label={t('ariaAdmin')}>
				<NavLink
					to="/admin"
					end
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('dashboard')}
				</NavLink>
				<NavLink
					to={API_CONNECTION_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('apiConnections')}
				</NavLink>
				<NavLink
					to={SP_CONNECTION_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('spConnections')}
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/users`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('users')}
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/groups`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('groups')}
				</NavLink>
				<NavLink
					to={`${IDENTITY_ROUTE_PREFIX}/roles`}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('roles')}
				</NavLink>
				<NavLink
					to={IDP_SETTINGS_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('idpSettings')}
				</NavLink>
				<NavLink
					to={ADMIN_USERS_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('adminAccounts')}
				</NavLink>
				<NavLink
					to={AUDIT_ROUTE_PREFIX}
					className={({ isActive }) => `evg-nav__link${isActive ? ' evg-nav__link--active' : ''}`}
					onClick={onNavigate}
				>
					{t('auditLog')}
				</NavLink>
				<NavLink to="/login" className="evg-nav__link" onClick={onNavigate}>
					{t('samlLogin')}
				</NavLink>
			</nav>
			<div className="evg-sidebar-footer">
				<LanguageSelect />
				{operatorUsername ? (
					<OperatorSessionBar
						username={operatorUsername}
						className="evg-operator-bar--mobile-only"
					/>
				) : null}
				<Button variant="ghost" onClick={() => void onLogout()}>
					{tCommon('logout')}
				</Button>
			</div>
		</>
	);
}
