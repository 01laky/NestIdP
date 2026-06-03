import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { IconMenu } from './icons';

export function MobileNavToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
	const { t } = useTranslation('common');

	return (
		<Button
			variant="secondary"
			className="evg-mobile-nav-toggle"
			data-testid="evg-mobile-nav-toggle"
			aria-expanded={expanded}
			aria-controls="evg-sidebar"
			onClick={onClick}
		>
			<IconMenu />
			<span className="evg-sr-only">{t('menu')}</span>
		</Button>
	);
}
