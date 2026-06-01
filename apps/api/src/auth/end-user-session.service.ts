import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { NodeEnv } from '../config/env.validation';
import type { EndUserSessionPayload } from './end-user-auth.types';

const DEFAULT_END_USER_SESSION_TTL_SECONDS = 3600;

@Injectable()
export class EndUserSessionService {
	constructor(private readonly configService: ConfigService) {}

	getSessionTtlSeconds(): number {
		const raw = this.configService.get<number | string>('END_USER_SESSION_TTL_SECONDS');
		if (raw == null || raw === '') {
			return DEFAULT_END_USER_SESSION_TTL_SECONDS;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_END_USER_SESSION_TTL_SECONDS;
	}

	sign(payload: EndUserSessionPayload): string {
		const payloadJson = JSON.stringify(payload);
		const payloadPart = Buffer.from(payloadJson, 'utf8').toString('base64url');
		const signature = this.signPayloadJson(payloadJson);
		return `${payloadPart}.${signature}`;
	}

	verify(token: string | undefined): EndUserSessionPayload | null {
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

		let payload: EndUserSessionPayload;
		try {
			payload = JSON.parse(payloadJson) as EndUserSessionPayload;
		} catch {
			return null;
		}

		const now = Math.floor(Date.now() / 1000);
		if (payload.exp <= now) {
			return null;
		}

		return payload;
	}

	createPayload(userId: string, username: string): EndUserSessionPayload {
		const now = Math.floor(Date.now() / 1000);
		const ttl = this.getSessionTtlSeconds();
		return {
			userId,
			username,
			iat: now,
			exp: now + ttl,
		};
	}

	setCookie(res: Response, payload: EndUserSessionPayload): void {
		const token = this.sign(payload);
		const ttl = this.getSessionTtlSeconds();
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;

		res.cookie(END_USER_SESSION_COOKIE_NAME, token, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
			maxAge: ttl * 1000,
		});
	}

	clearCookie(res: Response): void {
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;

		res.clearCookie(END_USER_SESSION_COOKIE_NAME, {
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
