import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../ui';

export type IdentitySection = 'users' | 'groups' | 'roles';

const SECTIONS: Array<{
	key: IdentitySection;
	labelKey: 'users' | 'groups' | 'roles';
	path: string;
}> = [
	{ key: 'users', labelKey: 'users', path: `${IDENTITY_ROUTE_PREFIX}/users` },
	{ key: 'groups', labelKey: 'groups', path: `${IDENTITY_ROUTE_PREFIX}/groups` },
	{ key: 'roles', labelKey: 'roles', path: `${IDENTITY_ROUTE_PREFIX}/roles` },
];

export function IdentitySectionNav({ current }: { current: IdentitySection }) {
	const { t } = useTranslation('nav');
	const { t: tIdentity } = useTranslation('identity');
	const links = SECTIONS.filter((section) => section.key !== current);

	return (
		<nav className="evg-cluster evg-identity-section-nav" aria-label={tIdentity('sectionNavAria')}>
			{links.map((section, index) => (
				<span key={section.key} className="evg-identity-section-nav__item">
					{index > 0 ? (
						<span className="evg-identity-section-nav__sep" aria-hidden="true">
							{' · '}
						</span>
					) : null}
					<ButtonLink variant="link" to={section.path}>
						{t(section.labelKey)}
					</ButtonLink>
				</span>
			))}
		</nav>
	);
}
