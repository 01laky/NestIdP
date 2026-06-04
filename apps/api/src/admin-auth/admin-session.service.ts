import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
	ADMIN_SESSION_COOKIE_NAME,
	DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
	DEFAULT_ADMIN_SESSION_TTL_SECONDS,
	MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
} from '@nestidp/shared';
import { NodeEnv } from '../config/env.validation';

export interface AdminSessionPayload {
	adminUserId: string;
	username: string;
	iat: number;
	exp: number;
	csrfToken: string;
}

@Injectable()
export class AdminSessionService {
	constructor(private readonly configService: ConfigService) {}

	getSessionTtlSeconds(remember = false): number {
		if (remember) {
			return this.getSessionRememberTtlSeconds();
		}
		const raw = this.configService.get<string>('ADMIN_SESSION_TTL_SECONDS');
		if (!raw) {
			return DEFAULT_ADMIN_SESSION_TTL_SECONDS;
		}
		const parsed = Number.parseInt(raw, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ADMIN_SESSION_TTL_SECONDS;
	}

	getSessionRememberTtlSeconds(): number {
		const raw = this.configService.get<string>('ADMIN_SESSION_REMEMBER_TTL_SECONDS');
		let ttl: number = DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS;
		if (raw) {
			const parsed = Number.parseInt(raw, 10);
			if (Number.isFinite(parsed) && parsed > 0) {
				ttl = parsed;
			}
		}
		return Math.min(ttl, MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS);
	}

	sign(payload: AdminSessionPayload): string {
		const payloadJson = JSON.stringify(payload);
		const payloadPart = Buffer.from(payloadJson, 'utf8').toString('base64url');
		const signature = this.signPayloadJson(payloadJson);
		return `${payloadPart}.${signature}`;
	}

	verify(token: string | undefined): AdminSessionPayload | null {
		if (!token) {
			return null;
		}

		const dotIndex = token.indexOf('.');
		if (dotIndex <= 0) {
			return null;
		}

		const payloadPart = token.slice(0, dotIndex);
		const signaturePart = token.slice(dotIndex + 1);

		let payloadJson: string;
		try {
			payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
		} catch {
			return null;
		}

		const expectedSignature = this.signPayloadJson(payloadJson);
		const sigA = Buffer.from(signaturePart, 'base64url');
		const sigB = Buffer.from(expectedSignature, 'base64url');
		if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
			return null;
		}

		let payload: AdminSessionPayload;
		try {
			payload = JSON.parse(payloadJson) as AdminSessionPayload;
		} catch {
			return null;
		}

		const now = Math.floor(Date.now() / 1000);
		if (payload.exp <= now) {
			return null;
		}

		return payload;
	}

	createPayload(
		adminUserId: string,
		username: string,
		csrfToken?: string,
		ttlSeconds?: number,
	): AdminSessionPayload {
		const now = Math.floor(Date.now() / 1000);
		const ttl = ttlSeconds ?? this.getSessionTtlSeconds(false);
		return {
			adminUserId,
			username,
			iat: now,
			exp: now + ttl,
			csrfToken: csrfToken ?? randomBytes(32).toString('hex'),
		};
	}

	setCookie(res: Response, payload: AdminSessionPayload, options?: { persistent?: boolean }): void {
		const token = this.sign(payload);
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;
		const cookieOptions: CookieOptions = {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
		};
		if (options?.persistent === true) {
			cookieOptions.maxAge = (payload.exp - payload.iat) * 1000;
		}

		res.cookie(ADMIN_SESSION_COOKIE_NAME, token, cookieOptions);
	}

	clearCookie(res: Response): void {
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;

		res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
		});
	}

	private signPayloadJson(payloadJson: string): string {
		const secret = this.configService.get<string>('SESSION_SECRET') ?? '';
		return createHmac('sha256', secret).update(payloadJson, 'utf8').digest('base64url');
	}
}
