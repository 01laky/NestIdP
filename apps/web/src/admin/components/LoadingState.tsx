export function LoadingState({ message = 'Loading…' }: { message?: string }) {
	return <p className="muted admin-loading">{message}</p>;
}
