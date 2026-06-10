import { Transform } from 'class-transformer';

/**
 * §6.1: the one optional-int env transform for boot validation. Empty/absent stays `undefined`
 * (so `@IsOptional()` skips), a parseable int becomes a number for the range validators, and a
 * non-numeric value is passed through UNCHANGED so `@IsInt()` rejects it loudly instead of it
 * silently becoming `undefined`.
 */
export function TransformOptionalInt(): PropertyDecorator {
	return Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const parsed = Number.parseInt(String(value), 10);
		return Number.isFinite(parsed) ? parsed : value;
	});
}
