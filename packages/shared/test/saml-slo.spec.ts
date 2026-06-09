import { describe, expect, it } from 'vitest';
import {
	LOGGED_OUT_ROUTE,
	SAML_SESSIONS_API_PATH,
	SAML_SESSIONS_LIST_PAGE_SIZE,
	SAML_SESSIONS_ROUTE_PREFIX,
	SAML_SLO_PATH,
	SAML_STATUS_PARTIAL_LOGOUT,
	SAML_STATUS_REQUEST_DENIED,
	SAML_STATUS_RESPONDER,
	SAML_STATUS_SUCCESS,
	BACKCHANNEL_LOGOUT_STATUSES,
	isBackchannelLogoutStatus,
	type BackchannelLogoutStatus,
	type SamlSsoSessionListResponseDto,
	type SamlSsoSessionPublicDto,
	type TerminateSamlSessionResponseDto,
	type TerminateSamlSessionsByUserResponseDto,
} from '../src/index.js';

describe('SAML SLO shared contracts', () => {
	it('SH-SLO-01: paths/constants are correct', () => {
		expect(SAML_SLO_PATH).toBe('/saml/slo');
		expect(SAML_SESSIONS_API_PATH).toBe('/api/admin/saml-sessions');
		expect(SAML_SESSIONS_ROUTE_PREFIX).toBe('/admin/sessions');
		expect(LOGGED_OUT_ROUTE).toBe('/logged-out');
		expect(SAML_SESSIONS_LIST_PAGE_SIZE).toBe(10);
	});

	it('SH-SLO-02: SAML status code constants are correct', () => {
		expect(SAML_STATUS_SUCCESS).toBe('urn:oasis:names:tc:SAML:2.0:status:Success');
		expect(SAML_STATUS_RESPONDER).toBe('urn:oasis:names:tc:SAML:2.0:status:Responder');
		expect(SAML_STATUS_REQUEST_DENIED).toBe('urn:oasis:names:tc:SAML:2.0:status:RequestDenied');
		expect(SAML_STATUS_PARTIAL_LOGOUT).toBe('urn:oasis:names:tc:SAML:2.0:status:PartialLogout');
	});

	it('SH-SLO-03: DTO shapes round-trip', () => {
		const session: SamlSsoSessionPublicDto = {
			id: 's1',
			userId: 'u1',
			username: 'alice',
			createdAt: '2026-01-01T00:00:00.000Z',
			lastSeenAt: '2026-01-01T00:00:00.000Z',
			expiresAt: '2026-01-01T01:00:00.000Z',
			loginIp: '1.2.3.4',
			userAgent: 'jest',
			lastSeenIp: '1.2.3.4',
			status: 'active',
			terminatedAt: null,
			terminatedReason: null,
			participations: [],
		};
		const list: SamlSsoSessionListResponseDto = { items: [session], total: 1 };
		const term: TerminateSamlSessionResponseDto = { ok: true, id: 's1', alreadyTerminated: false };
		const byUser: TerminateSamlSessionsByUserResponseDto = {
			ok: true,
			userId: 'u1',
			terminatedCount: 2,
		};
		expect(list.items[0].status).toBe('active');
		expect(term.alreadyTerminated).toBe(false);
		expect(byUser.terminatedCount).toBe(2);
	});

	it('SH-SLO-04: BACKCHANNEL_LOGOUT_STATUSES enumerates every status and the union derives from it', () => {
		expect(BACKCHANNEL_LOGOUT_STATUSES).toEqual([
			'pending',
			'in_flight',
			'succeeded',
			'partial',
			'failed',
			'given_up',
			'skipped_no_endpoint',
		]);
		// Compile-time: each tuple member is assignable to the derived union.
		const statuses: BackchannelLogoutStatus[] = [...BACKCHANNEL_LOGOUT_STATUSES];
		expect(statuses).toHaveLength(7);
	});

	it('SH-SLO-05: isBackchannelLogoutStatus narrows known statuses and rejects others', () => {
		for (const status of BACKCHANNEL_LOGOUT_STATUSES) {
			expect(isBackchannelLogoutStatus(status)).toBe(true);
		}
		expect(isBackchannelLogoutStatus('done')).toBe(false);
		expect(isBackchannelLogoutStatus('')).toBe(false);
	});
});
