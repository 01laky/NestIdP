export function ErrorBanner({ message }: { message: string }) {
	return (
		<p className="error admin-error" role="alert">
			{message}
		</p>
	);
}
