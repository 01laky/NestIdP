import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { NodeEnv } from '../config/env.validation';

export interface AdminSessionPayload {
	adminUserId: string;
	username: string;
	iat: number;
	exp: number;
}

const DEFAULT_SESSION_TTL_SECONDS = 28_800;

@Injectable()
export class AdminSessionService {
	constructor(private readonly configService: ConfigService) {}

	getSessionTtlSeconds(): number {
		const raw = this.configService.get<string>('ADMIN_SESSION_TTL_SECONDS');
		if (!raw) {
			return DEFAULT_SESSION_TTL_SECONDS;
		}
		const parsed = Number.parseInt(raw, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_TTL_SECONDS;
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

	createPayload(adminUserId: string, username: string): AdminSessionPayload {
		const now = Math.floor(Date.now() / 1000);
		const ttl = this.getSessionTtlSeconds();
		return {
			adminUserId,
			username,
			iat: now,
			exp: now + ttl,
		};
	}

	setCookie(res: Response, payload: AdminSessionPayload): void {
		const token = this.sign(payload);
		const ttl = this.getSessionTtlSeconds();
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;

		res.cookie(ADMIN_SESSION_COOKIE_NAME, token, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
			maxAge: ttl * 1000,
		});
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
