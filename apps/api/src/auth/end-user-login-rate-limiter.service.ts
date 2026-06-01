import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RateLimitEntry {
	count: number;
	windowStartMs: number;
}

const DEFAULT_IP_MAX = 10;
const DEFAULT_IP_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_USERNAME_MAX = 5;
const DEFAULT_USERNAME_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class EndUserLoginRateLimiterService {
	private readonly byIp = new Map<string, RateLimitEntry>();
	private readonly byUsername = new Map<string, RateLimitEntry>();

	constructor(private readonly configService: ConfigService) {}

	isLimitedByIp(ip: string): boolean {
		return this.isLimited(this.byIp, ip, this.getIpMax(), this.getIpWindowMs());
	}

	isLimitedByUsername(username: string): boolean {
		return this.isLimited(
			this.byUsername,
			username,
			this.getUsernameMax(),
			this.getUsernameWindowMs(),
		);
	}

	recordFailure(ip: string, username: string): void {
		this.record(this.byIp, ip, this.getIpWindowMs());
		this.record(this.byUsername, username, this.getUsernameWindowMs());
	}

	reset(ip: string, username: string): void {
		this.byIp.delete(ip);
		this.byUsername.delete(username);
	}

	clear(): void {
		this.byIp.clear();
		this.byUsername.clear();
	}

	private isLimited(
		map: Map<string, RateLimitEntry>,
		key: string,
		max: number,
		windowMs: number,
	): boolean {
		const entry = map.get(key);
		if (!entry) {
			return false;
		}
		const now = Date.now();
		if (now - entry.windowStartMs >= windowMs) {
			map.delete(key);
			return false;
		}
		return entry.count >= max;
	}

	private record(map: Map<string, RateLimitEntry>, key: string, windowMs: number): void {
		const now = Date.now();
		const entry = map.get(key);
		if (!entry || now - entry.windowStartMs >= windowMs) {
			map.set(key, { count: 1, windowStartMs: now });
			return;
		}
		entry.count += 1;
	}

	private getIpMax(): number {
		return this.parsePositiveInt('END_USER_LOGIN_RATE_LIMIT_MAX', DEFAULT_IP_MAX);
	}

	private getIpWindowMs(): number {
		return this.parsePositiveInt('END_USER_LOGIN_RATE_LIMIT_WINDOW_MS', DEFAULT_IP_WINDOW_MS);
	}

	private getUsernameMax(): number {
		return this.parsePositiveInt('END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX', DEFAULT_USERNAME_MAX);
	}

	private getUsernameWindowMs(): number {
		return this.parsePositiveInt(
			'END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS',
			DEFAULT_USERNAME_WINDOW_MS,
		);
	}

	private parsePositiveInt(key: string, fallback: number): number {
		const raw = this.configService.get<number | string>(key);
		if (raw == null || raw === '') {
			return fallback;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	}
}
