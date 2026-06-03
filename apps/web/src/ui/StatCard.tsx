export function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="evg-stat">
			<span className="evg-stat__value">{value}</span>
			<span className="evg-muted">{label}</span>
		</div>
	);
}
