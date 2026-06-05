import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Prisma cuid ids — not UUIDs. */
const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
	transform(value: string): string {
		if (!CUID_PATTERN.test(value)) {
			throw new BadRequestException('Invalid id');
		}
		return value;
	}
}
