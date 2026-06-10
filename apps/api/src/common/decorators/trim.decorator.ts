import { Transform } from 'class-transformer';

/**
 * §6.3 / §A12: the one DTO string-trim transform. Non-strings (incl. null/undefined) pass through
 * untouched so `@IsOptional()` / nullable fields keep their semantics; validators run on the
 * trimmed value.
 */
export function Trim(): PropertyDecorator {
	return Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
}
