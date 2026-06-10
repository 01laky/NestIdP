import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// Prisma cuid ids — not UUIDs. Lowercase by construction ('c' + 24 lowercase base36 chars), so no `i`
// flag; bounded at 64 chars total so an arbitrarily long "id" never reaches the DB.
const CUID_PATTERN = /^c[a-z0-9]{24,63}$/;

export function isCuid(value: string): boolean {
	return CUID_PATTERN.test(value);
}

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
	transform(value: string): string {
		if (!isCuid(value)) {
			throw new BadRequestException('Invalid id');
		}
		return value;
	}
}
