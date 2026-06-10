import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME, MAX_END_USER_SESSION_TTL_SECONDS } from '@nestidp/shared';
import { HmacSessionCodec } from '../../common/session/hmac-session-codec';
import { positiveIntOrDefault } from '../../common/config/positive-int.util';
import { NodeEnv } from '../../config/env.validation';
import type { EndUserSessionPayload } from '../end-user-auth.types';

const DEFAULT_END_USER_SESSION_TTL_SECONDS = 3600;

@Injectable()
export class EndUserSessionService {
	// §6.5: HMAC sign/verify is shared with the admin session service.
	private readonly codec: HmacSessionCodec<EndUserSessionPayload>;

	constructor(private readonly configService: ConfigService) {
		this.codec = new HmacSessionCodec(() => this.requireSessionSecret());
		// §5.C: fail closed at construction — never fall back to HMAC-signing sessions with an empty key.
		this.requireSessionSecret();
	}

	private requireSessionSecret(): string {
		const secret = this.configService.get<string>('SESSION_SECRET');
		if (!secret) {
			throw new Error('SESSION_SECRET is not set — refusing to sign/verify end-user sessions');
		}
		return secret;
	}

	getSessionTtlSeconds(): number {
		// §5.C: clamp like the admin remember-me TTL — a misconfigured huge value must not produce a
		// practically-immortal end-user session.
		const ttl = positiveIntOrDefault(
			this.configService.get<number | string>('END_USER_SESSION_TTL_SECONDS'),
			DEFAULT_END_USER_SESSION_TTL_SECONDS,
		);
		return Math.min(ttl, MAX_END_USER_SESSION_TTL_SECONDS);
	}

	sign(payload: EndUserSessionPayload): string {
		return this.codec.sign(payload);
	}

	verify(token: string | undefined, nowSeconds?: number): EndUserSessionPayload | null {
		return this.codec.verify(token, nowSeconds);
	}

	createPayload(
		userId: string,
		username: string,
		sid?: string,
		nowSeconds: number = Math.floor(Date.now() / 1000),
	): EndUserSessionPayload {
		const now = nowSeconds;
		const ttl = this.getSessionTtlSeconds();
		return {
			userId,
			username,
			...(sid ? { sid } : {}),
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
}
