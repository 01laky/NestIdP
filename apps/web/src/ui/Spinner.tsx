export function Spinner({ label = 'Loading' }: { label?: string }) {
	return (
		<span className="evg-loading" role="status">
			<span className="evg-spinner" aria-hidden />
			{label}
		</span>
	);
}
