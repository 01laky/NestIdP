import { describe, expect, it } from 'vitest';
import {
	AUTH_API_PATH,
	END_USER_SESSION_COOKIE_NAME,
	LOGIN_PAGE_ROUTE,
	SAML_SESSION_BIND_PORT,
	SAML_SESSION_BODY_FIELD,
	SAML_SESSION_QUERY_PARAM,
	type EndUserLoginResponseDto,
	type EndUserSessionStatusResponseDto,
} from '@shared/end-user-auth.js';

describe('end-user-auth shared', () => {
	it('SH-AUTH-01: END_USER_SESSION_COOKIE_NAME is nestidp_user_session', () => {
		expect(END_USER_SESSION_COOKIE_NAME).toBe('nestidp_user_session');
	});

	it('SH-AUTH-02: LOGIN_PAGE_ROUTE, SAML_SESSION_QUERY_PARAM, AUTH_API_PATH', () => {
		expect(LOGIN_PAGE_ROUTE).toBe('/login');
		expect(SAML_SESSION_QUERY_PARAM).toBe('samlSessionId');
		expect(SAML_SESSION_BODY_FIELD).toBe('samlSessionId');
		expect(AUTH_API_PATH).toBe('/api/auth');
	});

	it('SH-AUTH-03: SAML_SESSION_BIND_PORT token export', () => {
		expect(SAML_SESSION_BIND_PORT).toBe('SAML_SESSION_BIND_PORT');
	});

	it('SH-AUTH-04: EndUserSessionStatusResponseDto shape', () => {
		const sample: EndUserSessionStatusResponseDto = {
			authenticated: false,
			user: null,
			samlSession: {
				id: 'c1234567890123456789012345',
				bound: false,
				expired: false,
				spActive: true,
				readyToComplete: false,
			},
		};
		expect(sample.samlSession?.bound).toBe(false);
	});

	it('SH-AUTH-05: EndUserLoginResponseDto shape', () => {
		const sample: EndUserLoginResponseDto = {
			ok: true,
			samlSessionBound: true,
			user: {
				id: 'c1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		};
		expect(sample.ok).toBe(true);
	});
});
