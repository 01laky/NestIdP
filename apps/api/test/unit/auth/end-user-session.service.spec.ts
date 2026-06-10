import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME, MAX_END_USER_SESSION_TTL_SECONDS } from '@nestidp/shared';
import { EndUserSessionService } from '@api/auth/services/end-user-session.service';

describe('EndUserSessionService', () => {
	const config = {
		get: jest.fn((key: string) => {
			if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
			if (key === 'NODE_ENV') return 'test';
			if (key === 'END_USER_SESSION_TTL_SECONDS') return undefined;
			return undefined;
		}),
	} as unknown as ConfigService;

	const service = new EndUserSessionService(config);

	it('API-AUTH-SESSION-01: sign + verify round-trip', () => {
		const payload = service.createPayload('user-1', 'alice');
		const token = service.sign(payload);
		expect(service.verify(token)).toEqual(payload);
	});

	it('API-AUTH-SESSION-02: tampered token → null', () => {
		const payload = service.createPayload('user-1', 'alice');
		const token = service.sign(payload);
		expect(service.verify(`${token}x`)).toBeNull();
	});

	it('API-AUTH-SESSION-03: expired token → null', () => {
		const now = Math.floor(Date.now() / 1000);
		const token = service.sign({
			userId: 'user-1',
			username: 'alice',
			iat: now - 7200,
			exp: now - 3600,
		});
		expect(service.verify(token)).toBeNull();
	});

	it('API-AUTH-SESSION-04: wrong SESSION_SECRET → null', () => {
		const payload = service.createPayload('user-1', 'alice');
		const token = service.sign(payload);
		const other = new EndUserSessionService({
			get: (key: string) => (key === 'SESSION_SECRET' ? 'other-secret-value' : 'test'),
		} as unknown as ConfigService);
		expect(other.verify(token)).toBeNull();
	});

	it('sets HttpOnly cookie on response', () => {
		const payload = service.createPayload('user-1', 'alice');
		const cookie = jest.fn();
		const res = { cookie, clearCookie: jest.fn() } as unknown as Response;
		service.setCookie(res, payload);
		expect(cookie).toHaveBeenCalledWith(
			END_USER_SESSION_COOKIE_NAME,
			expect.any(String),
			expect.objectContaining({ httpOnly: true }),
		);
	});

	it('custom END_USER_SESSION_TTL_SECONDS affects createPayload exp', () => {
		const customConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'END_USER_SESSION_TTL_SECONDS') return '600';
				return 'test';
			}),
		} as unknown as ConfigService;
		const customService = new EndUserSessionService(customConfig);
		const payload = customService.createPayload('u1', 'alice');
		expect(payload.exp - payload.iat).toBe(600);
	});

	it('API-AUTH-SESSION-05: token without dot separator → null', () => {
		expect(service.verify('nodotseparator')).toBeNull();
	});

	it('API-AUTH-SESSION-06: invalid base64url payload → null', () => {
		expect(service.verify('!!!.signature')).toBeNull();
	});

	it('API-AUTH-SESSION-07: setCookie uses secure flag in production', () => {
		const prodConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'NODE_ENV') return 'production';
				return undefined;
			}),
		} as unknown as ConfigService;
		const prodService = new EndUserSessionService(prodConfig);
		const cookie = jest.fn();
		const res = { cookie, clearCookie: jest.fn() } as unknown as Response;
		prodService.setCookie(res, prodService.createPayload('u1', 'alice'));
		expect(cookie).toHaveBeenCalledWith(
			END_USER_SESSION_COOKIE_NAME,
			expect.any(String),
			expect.objectContaining({ secure: true }),
		);
	});

	it('API-AUTH-SESSION-08: invalid END_USER_SESSION_TTL_SECONDS falls back to default', () => {
		const badTtlConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'END_USER_SESSION_TTL_SECONDS') return 'not-a-number';
				return 'test';
			}),
		} as unknown as ConfigService;
		const badTtlService = new EndUserSessionService(badTtlConfig);
		const payload = badTtlService.createPayload('u1', 'alice');
		expect(payload.exp - payload.iat).toBe(3600);
	});

	it('clearCookie uses same path and sameSite as setCookie', () => {
		const clearCookie = jest.fn();
		const res = { cookie: jest.fn(), clearCookie } as unknown as Response;
		service.clearCookie(res);
		expect(clearCookie).toHaveBeenCalledWith(
			END_USER_SESSION_COOKIE_NAME,
			expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: true }),
		);
	});

	it('API-AUTH-SESSION-09: missing/empty SESSION_SECRET → constructor throws (fail closed)', () => {
		const emptyConfig = {
			get: jest.fn(() => undefined),
		} as unknown as ConfigService;
		expect(() => new EndUserSessionService(emptyConfig)).toThrow(/SESSION_SECRET/);
		const blankConfig = {
			get: jest.fn((key: string) => (key === 'SESSION_SECRET' ? '' : 'test')),
		} as unknown as ConfigService;
		expect(() => new EndUserSessionService(blankConfig)).toThrow(/SESSION_SECRET/);
	});

	it('API-AUTH-SESSION-10: TTL from env is clamped to the 90-day ceiling', () => {
		const hugeConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'END_USER_SESSION_TTL_SECONDS') return '99999999';
				return 'test';
			}),
		} as unknown as ConfigService;
		const hugeService = new EndUserSessionService(hugeConfig);
		expect(hugeService.getSessionTtlSeconds()).toBe(MAX_END_USER_SESSION_TTL_SECONDS);
	});
});
