import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminSessionService } from './admin-session.service';

describe('AdminSessionService', () => {
	const config = {
		get: jest.fn((key: string) => {
			if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
			if (key === 'NODE_ENV') return 'test';
			if (key === 'ADMIN_SESSION_TTL_SECONDS') return undefined;
			return undefined;
		}),
	} as unknown as ConfigService;

	const service = new AdminSessionService(config);

	it('API-SES-01: sign + verify round-trip', () => {
		const payload = service.createPayload('admin-1', 'admin');
		const token = service.sign(payload);
		expect(service.verify(token)).toEqual(payload);
	});

	it('API-SES-02: tampered token → null', () => {
		const payload = service.createPayload('admin-1', 'admin');
		const token = service.sign(payload);
		expect(service.verify(`${token}x`)).toBeNull();
	});

	it('API-SES-03: expired token → null', () => {
		const now = Math.floor(Date.now() / 1000);
		const token = service.sign({
			adminUserId: 'admin-1',
			username: 'admin',
			iat: now - 7200,
			exp: now - 3600,
		});
		expect(service.verify(token)).toBeNull();
	});

	it('API-SES-04: wrong SESSION_SECRET → null', () => {
		const payload = service.createPayload('admin-1', 'admin');
		const token = service.sign(payload);
		const other = new AdminSessionService({
			get: (key: string) => (key === 'SESSION_SECRET' ? 'other-secret-value' : 'test'),
		} as unknown as ConfigService);
		expect(other.verify(token)).toBeNull();
	});

	it('sets HttpOnly cookie on response', () => {
		const payload = service.createPayload('admin-1', 'admin');
		const cookie = jest.fn();
		const res = { cookie, clearCookie: jest.fn() } as unknown as Response;
		service.setCookie(res, payload);
		expect(cookie).toHaveBeenCalledWith(
			ADMIN_SESSION_COOKIE_NAME,
			expect.any(String),
			expect.objectContaining({ httpOnly: true }),
		);
	});

	it('API-SES-05: token without dot returns null', () => {
		expect(service.verify('nodothere')).toBeNull();
	});

	it('API-SES-06: tampered payload part returns null', () => {
		const payload = service.createPayload('admin-1', 'admin');
		const token = service.sign(payload);
		const tampered = `XXXX${token.slice(4)}`;
		expect(service.verify(tampered)).toBeNull();
	});

	it('API-SES-07: invalid JSON payload returns null', () => {
		const garbage = `${Buffer.from('not-json', 'utf8').toString('base64url')}.abc`;
		expect(service.verify(garbage)).toBeNull();
	});

	it('API-SES-08: custom ADMIN_SESSION_TTL_SECONDS affects createPayload exp', () => {
		const customConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'ADMIN_SESSION_TTL_SECONDS') return '600';
				return 'test';
			}),
		} as unknown as ConfigService;
		const customService = new AdminSessionService(customConfig);
		const payload = customService.createPayload('a1', 'admin');
		expect(payload.exp - payload.iat).toBe(600);
	});

	it('API-SES-09: invalid TTL falls back to default 28800', () => {
		const badConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'ADMIN_SESSION_TTL_SECONDS') return 'not-a-number';
				return 'test';
			}),
		} as unknown as ConfigService;
		const badService = new AdminSessionService(badConfig);
		expect(badService.getSessionTtlSeconds()).toBe(28_800);
	});

	it('API-SES-10: clearCookie uses same path and sameSite as setCookie', () => {
		const clearCookie = jest.fn();
		const res = { cookie: jest.fn(), clearCookie } as unknown as Response;
		service.clearCookie(res);
		expect(clearCookie).toHaveBeenCalledWith(
			ADMIN_SESSION_COOKIE_NAME,
			expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: true }),
		);
	});

	it('API-SES-11: production NODE_ENV sets secure cookie flag', () => {
		const prodConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SESSION_SECRET') return 'test-session-secret-min-16';
				if (key === 'NODE_ENV') return 'production';
				return undefined;
			}),
		} as unknown as ConfigService;
		const prodService = new AdminSessionService(prodConfig);
		const cookie = jest.fn();
		const res = { cookie, clearCookie: jest.fn() } as unknown as Response;
		prodService.setCookie(res, prodService.createPayload('a1', 'admin'));
		expect(cookie).toHaveBeenCalledWith(
			ADMIN_SESSION_COOKIE_NAME,
			expect.any(String),
			expect.objectContaining({ secure: true }),
		);
	});

	it('API-SES-12: undefined token returns null', () => {
		expect(service.verify(undefined)).toBeNull();
	});

	it('API-SES-13: empty string token returns null', () => {
		expect(service.verify('')).toBeNull();
	});
});
