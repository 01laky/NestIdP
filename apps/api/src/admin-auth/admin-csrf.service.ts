import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AdminCsrfService {
	generateToken(): string {
		return randomBytes(32).toString('hex');
	}

	validateToken(headerValue: string | undefined, expected: string | undefined): boolean {
		if (!headerValue || !expected) {
			return false;
		}
		const a = Buffer.from(headerValue, 'utf8');
		const b = Buffer.from(expected, 'utf8');
		if (a.length !== b.length) {
			return false;
		}
		return timingSafeEqual(a, b);
	}
}
