import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { HmacSessionCodec } from '../../common/session/hmac-session-codec';
import { NodeEnv } from '../../config/env.validation';
import type { EndUserSessionPayload } from '../end-user-auth.types';

const DEFAULT_END_USER_SESSION_TTL_SECONDS = 3600;

@Injectable()
export class EndUserSessionService {
	// §6.5: HMAC sign/verify is shared with the admin session service.
	private readonly codec: HmacSessionCodec<EndUserSessionPayload>;

	constructor(private readonly configService: ConfigService) {
		this.codec = new HmacSessionCodec(() => this.configService.get<string>('SESSION_SECRET') ?? '');
	}

	getSessionTtlSeconds(): number {
		const raw = this.configService.get<number | string>('END_USER_SESSION_TTL_SECONDS');
		if (raw == null || raw === '') {
			return DEFAULT_END_USER_SESSION_TTL_SECONDS;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_END_USER_SESSION_TTL_SECONDS;
	}

	sign(payload: EndUserSessionPayload): string {
		return this.codec.sign(payload);
	}

	verify(token: string | undefined): EndUserSessionPayload | null {
		return this.codec.verify(token);
	}

	createPayload(userId: string, username: string, sid?: string): EndUserSessionPayload {
		const now = Math.floor(Date.now() / 1000);
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
