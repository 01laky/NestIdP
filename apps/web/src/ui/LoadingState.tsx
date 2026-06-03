import { Spinner } from './Spinner';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
	return <Spinner label={message} />;
}
