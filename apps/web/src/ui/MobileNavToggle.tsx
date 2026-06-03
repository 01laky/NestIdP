import { Button } from './Button';
import { IconMenu } from './icons';

export function MobileNavToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
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
			<span className="evg-sr-only">Menu</span>
		</Button>
	);
}
