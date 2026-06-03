export function ErrorBanner({ message }: { message: string }) {
	return (
		<div className="evg-error-banner" role="alert">
			{message}
		</div>
	);
}
