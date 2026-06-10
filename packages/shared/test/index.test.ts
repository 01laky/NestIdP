import { describe, expect, it } from 'vitest';
import {
	API_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
	type ApiConnectionDto,
} from '@shared/connections.js';
import type { HealthResponse, ReadyCheckResult, ReadyResponse } from '@shared/health.js';

describe('connection route prefixes', () => {
	it('keeps API and SP admin routes separate', () => {
		expect(API_CONNECTION_ROUTE_PREFIX).not.toBe(SP_CONNECTION_ROUTE_PREFIX);
		expect(API_CONNECTION_ROUTE_PREFIX).toContain('api-connections');
		expect(SP_CONNECTION_ROUTE_PREFIX).toContain('sp-connections');
	});

	it('uses /admin base path for both connection types', () => {
		expect(API_CONNECTION_ROUTE_PREFIX.startsWith('/admin/')).toBe(true);
		expect(SP_CONNECTION_ROUTE_PREFIX.startsWith('/admin/')).toBe(true);
	});

	it('does not cross-contaminate route segments', () => {
		expect(API_CONNECTION_ROUTE_PREFIX).not.toContain('sp-connections');
		expect(SP_CONNECTION_ROUTE_PREFIX).not.toContain('api-connections');
	});
});

describe('ApiConnectionDto', () => {
	const fullDto: ApiConnectionDto = {
		id: 'conn-1',
		name: 'HR System',
		baseUrl: 'https://hr.example.com/api',
		authType: 'BEARER',
		hasBearerToken: true,
		apiContractConfig: null,
		oauthTokenUrl: null,
		oauthClientId: null,
		oauthScope: null,
		oauthAudience: null,
		oauthClientAuthMethod: null,
		oauthTokenRequestParams: null,
		hasOauthClientSecret: false,
		oauthLastTokenAt: null,
		proxyEnabled: false,
		proxyUrl: null,
		proxyUsername: null,
		hasProxyPassword: false,
		noProxyHosts: null,
		lastProxyCheckStatus: null,
		lastProxyCheckAt: null,
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	};

	it('accepts full ApiConnectionDto shape', () => {
		expect(fullDto.name).toBe('HR System');
		expect(fullDto.id).toBe('conn-1');
	});

	it('accepts sync metadata fields aligned with schema', () => {
		const dto: ApiConnectionDto = {
			...fullDto,
			lastSyncStatus: 'SUCCESS',
			lastSyncAt: '2026-01-01T00:00:00.000Z',
		};
		expect(dto.authType).toBe('BEARER');
		expect(dto.lastSyncStatus).toBe('SUCCESS');
		expect(dto.lastSyncAt).not.toBeNull();
	});

	it('allows null lastSyncAt before first sync', () => {
		expect(fullDto.lastSyncAt).toBeNull();
	});
});

describe('HealthResponse', () => {
	it('uses fixed ok status and service identifier', () => {
		const health: HealthResponse = {
			status: 'ok',
			service: 'nest-idp-api',
			version: '1.19.0',
			gitSha: null,
			uptimeSeconds: 42,
			audit: { persistFailures: 0, lastPersistFailureAt: null },
			schedulers: {
				backchannel: { lastTickAt: null, lastProcessed: null },
				sync: { lastTickAt: null, lastProcessed: null },
				certRotation: { lastTickAt: null, lastProcessed: null },
			},
		};
		expect(health.status).toBe('ok');
		expect(health.service).toBe('nest-idp-api');
		expect(health.schedulers.sync.lastTickAt).toBeNull();
	});
});

describe('ReadyResponse', () => {
	it('allows all documented database states', () => {
		const states: ReadyResponse['database'][] = ['connected', 'disconnected', 'not_configured'];
		for (const database of states) {
			const ready: ReadyResponse = {
				status: database === 'connected' ? 'ok' : 'unavailable',
				service: 'nest-idp-api',
				database,
			};
			expect(ready.database).toBe(database);
		}
	});
});

describe('ReadyCheckResult', () => {
	it('allows only documented HTTP status codes', () => {
		const ok: ReadyCheckResult = {
			httpStatus: 200,
			body: { status: 'ok', service: 'nest-idp-api', database: 'connected' },
		};
		const fail: ReadyCheckResult = {
			httpStatus: 503,
			body: { status: 'unavailable', service: 'nest-idp-api', database: 'disconnected' },
		};
		expect(ok.httpStatus).toBe(200);
		expect(fail.httpStatus).toBe(503);
	});

	it('pairs 200 with ok status and 503 with unavailable', () => {
		const connected: ReadyCheckResult = {
			httpStatus: 200,
			body: { status: 'ok', service: 'nest-idp-api', database: 'connected' },
		};
		const notConfigured: ReadyCheckResult = {
			httpStatus: 503,
			body: { status: 'unavailable', service: 'nest-idp-api', database: 'not_configured' },
		};
		expect(connected.body.status).toBe('ok');
		expect(notConfigured.body.status).toBe('unavailable');
	});
});
