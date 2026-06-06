import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RateLimitEntry {
	count: number;
	windowStartMs: number;
}

const DEFAULT_IP_MAX = 30;
const DEFAULT_IP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Per-IP request counter for the public, state-mutating `/saml/slo` endpoint.
 * In-memory (single-instance) — same approach as EndUserLoginRateLimiterService.
 */
@Injectable()
export class SamlSloRateLimiterService {
	private readonly byIp = new Map<string, RateLimitEntry>();

	constructor(private readonly configService: ConfigService) {}

	/** Records the request and returns true when the caller is now over the limit. */
	hitAndCheck(ip: string): boolean {
		const max = this.getIpMax();
		const windowMs = this.getIpWindowMs();
		const now = Date.now();
		const entry = this.byIp.get(ip);
		if (!entry || now - entry.windowStartMs >= windowMs) {
			this.byIp.set(ip, { count: 1, windowStartMs: now });
			return 1 > max;
		}
		entry.count += 1;
		return entry.count > max;
	}

	clear(): void {
		this.byIp.clear();
	}

	private getIpMax(): number {
		const raw = this.configService.get<number | string>('SAML_SLO_RATE_IP_MAX');
		const parsed = Number.parseInt(String(raw ?? ''), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IP_MAX;
	}

	private getIpWindowMs(): number {
		const raw = this.configService.get<number | string>('SAML_SLO_RATE_WINDOW_MS');
		const parsed = Number.parseInt(String(raw ?? ''), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IP_WINDOW_MS;
	}
}
