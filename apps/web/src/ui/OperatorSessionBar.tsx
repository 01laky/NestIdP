import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';

export function OperatorSessionBar({
	username,
	className = '',
}: {
	username: string;
	className?: string;
}) {
	const { t } = useTranslation('common');

	return (
		<div className={`evg-operator-bar ${className}`.trim()}>
			<span>{t('signedInAs', { username })}</span>
			<Link to={`${ADMIN_USERS_ROUTE_PREFIX}#change-password`}>{t('changePassword')}</Link>
		</div>
	);
}
