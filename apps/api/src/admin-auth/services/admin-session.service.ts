import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
	ADMIN_SESSION_COOKIE_NAME,
	DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
	DEFAULT_ADMIN_SESSION_TTL_SECONDS,
	MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
} from '@nestidp/shared';
import { HmacSessionCodec } from '../../common/session/hmac-session-codec';
import { positiveIntOrDefault } from '../../common/config/positive-int.util';
import { NodeEnv } from '../../config/env.validation';

export interface AdminSessionPayload {
	adminUserId: string;
	username: string;
	iat: number;
	exp: number;
	csrfToken: string;
}

@Injectable()
export class AdminSessionService {
	// §6.5: HMAC sign/verify is shared with the end-user session service.
	private readonly codec: HmacSessionCodec<AdminSessionPayload>;

	constructor(private readonly configService: ConfigService) {
		this.codec = new HmacSessionCodec(() => this.requireSessionSecret());
		// §5.C: fail closed at construction — never fall back to HMAC-signing sessions with an empty key.
		this.requireSessionSecret();
	}

	private requireSessionSecret(): string {
		const secret = this.configService.get<string>('SESSION_SECRET');
		if (!secret) {
			throw new Error('SESSION_SECRET is not set — refusing to sign/verify admin sessions');
		}
		return secret;
	}

	getSessionTtlSeconds(remember = false): number {
		if (remember) {
			return this.getSessionRememberTtlSeconds();
		}
		return positiveIntOrDefault(
			this.configService.get<string>('ADMIN_SESSION_TTL_SECONDS'),
			DEFAULT_ADMIN_SESSION_TTL_SECONDS,
		);
	}

	getSessionRememberTtlSeconds(): number {
		const ttl = positiveIntOrDefault(
			this.configService.get<string>('ADMIN_SESSION_REMEMBER_TTL_SECONDS'),
			DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
		);
		return Math.min(ttl, MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS);
	}

	sign(payload: AdminSessionPayload): string {
		return this.codec.sign(payload);
	}

	verify(token: string | undefined): AdminSessionPayload | null {
		return this.codec.verify(token);
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
}
