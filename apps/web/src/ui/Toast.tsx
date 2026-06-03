import { Button } from './Button';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	return (
		<div className="evg-toast" role="status">
			<span>{message}</span>
			<Button variant="ghost" size="sm" aria-label="Dismiss" onClick={onDismiss}>
				×
			</Button>
		</div>
	);
}
