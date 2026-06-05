import { Injectable } from '@nestjs/common';

interface RateLimitEntry {
	count: number;
	windowStartMs: number;
}

@Injectable()
export class LoginRateLimiterService {
	private readonly attempts = new Map<string, RateLimitEntry>();
	private readonly maxAttempts = 10;
	private readonly windowMs = 15 * 60 * 1000;

	isLimited(ip: string): boolean {
		const entry = this.attempts.get(ip);
		if (!entry) {
			return false;
		}

		const now = Date.now();
		if (now - entry.windowStartMs >= this.windowMs) {
			this.attempts.delete(ip);
			return false;
		}

		return entry.count >= this.maxAttempts;
	}

	recordFailure(ip: string): void {
		const now = Date.now();
		const entry = this.attempts.get(ip);

		if (!entry || now - entry.windowStartMs >= this.windowMs) {
			this.attempts.set(ip, { count: 1, windowStartMs: now });
			return;
		}

		entry.count += 1;
	}

	reset(ip: string): void {
		this.attempts.delete(ip);
	}

	clear(): void {
		this.attempts.clear();
	}
}
