import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RateLimitEntry {
	count: number;
	windowStartMs: number;
}

@Injectable()
export class AdminUserCreateRateLimiterService {
	private readonly byAdminId = new Map<string, RateLimitEntry>();
	private readonly byIp = new Map<string, RateLimitEntry>();

	constructor(private readonly configService: ConfigService) {}

	isLimited(adminId: string, ip: string): boolean {
		return this.isKeyLimited(this.byAdminId, adminId) || this.isKeyLimited(this.byIp, ip);
	}

	recordAttempt(adminId: string, ip: string): void {
		this.recordKey(this.byAdminId, adminId);
		this.recordKey(this.byIp, ip);
	}

	clear(): void {
		this.byAdminId.clear();
		this.byIp.clear();
	}

	private getMaxAttempts(): number {
		const raw = this.configService.get<string>('ADMIN_USER_CREATE_RATE_LIMIT_MAX');
		const parsed = Number.parseInt(String(raw ?? '5'), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
	}

	private getWindowMs(): number {
		const raw = this.configService.get<string>('ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS');
		const parsed = Number.parseInt(String(raw ?? '900000'), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 900000;
	}

	private isKeyLimited(store: Map<string, RateLimitEntry>, key: string): boolean {
		const entry = store.get(key);
		if (!entry) {
			return false;
		}
		const now = Date.now();
		if (now - entry.windowStartMs >= this.getWindowMs()) {
			store.delete(key);
			return false;
		}
		return entry.count >= this.getMaxAttempts();
	}

	private recordKey(store: Map<string, RateLimitEntry>, key: string): void {
		const now = Date.now();
		const entry = store.get(key);
		if (!entry || now - entry.windowStartMs >= this.getWindowMs()) {
			store.set(key, { count: 1, windowStartMs: now });
			return;
		}
		entry.count += 1;
	}
}
