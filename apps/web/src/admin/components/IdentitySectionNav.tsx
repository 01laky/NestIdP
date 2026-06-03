import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { ButtonLink } from '../../ui';

export type IdentitySection = 'users' | 'groups' | 'roles';

const SECTIONS: Array<{ key: IdentitySection; label: string; path: string }> = [
	{ key: 'users', label: 'Users', path: `${IDENTITY_ROUTE_PREFIX}/users` },
	{ key: 'groups', label: 'Groups', path: `${IDENTITY_ROUTE_PREFIX}/groups` },
	{ key: 'roles', label: 'Roles', path: `${IDENTITY_ROUTE_PREFIX}/roles` },
];

export function IdentitySectionNav({ current }: { current: IdentitySection }) {
	const links = SECTIONS.filter((section) => section.key !== current);

	return (
		<nav className="evg-cluster evg-identity-section-nav" aria-label="Identity sections">
			{links.map((section, index) => (
				<span key={section.key} className="evg-identity-section-nav__item">
					{index > 0 ? (
						<span className="evg-identity-section-nav__sep" aria-hidden="true">
							{' · '}
						</span>
					) : null}
					<ButtonLink variant="link" to={section.path}>
						{section.label}
					</ButtonLink>
				</span>
			))}
		</nav>
	);
}
