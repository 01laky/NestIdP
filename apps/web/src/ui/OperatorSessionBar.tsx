import { Link } from 'react-router-dom';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';

export function OperatorSessionBar({
	username,
	className = '',
}: {
	username: string;
	className?: string;
}) {
	return (
		<div className={`evg-operator-bar ${className}`.trim()}>
			<span>
				Signed in as <strong>{username}</strong>
			</span>
			<Link to={`${ADMIN_USERS_ROUTE_PREFIX}#change-password`}>Change password</Link>
		</div>
	);
}
