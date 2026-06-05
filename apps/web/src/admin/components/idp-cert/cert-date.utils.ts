export function formatLocalYyyyMmDd(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function addLocalDays(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return formatLocalYyyyMmDd(d);
}

export function addLocalYears(years: number): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() + years);
	return formatLocalYyyyMmDd(d);
}
