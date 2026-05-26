import { describe, expect, it } from 'vitest';
import {
	API_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
	type ApiConnectionStubDto,
	type SpConnectionStubDto,
} from './connections.js';
import type { HealthResponse, ReadyCheckResult, ReadyResponse } from './health.js';

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

describe('ApiConnectionStubDto', () => {
	it('accepts minimal required fields', () => {
		const dto: ApiConnectionStubDto = {
			name: 'HR System',
			baseUrl: 'https://hr.example.com/api',
		};
		expect(dto.name).toBe('HR System');
		expect(dto.id).toBeUndefined();
	});

	it('accepts optional id', () => {
		const dto: ApiConnectionStubDto = {
			id: 'conn-1',
			name: 'HR System',
			baseUrl: 'https://hr.example.com/api',
		};
		expect(dto.id).toBe('conn-1');
	});
});

describe('SpConnectionStubDto', () => {
	it('accepts minimal required SAML fields', () => {
		const dto: SpConnectionStubDto = {
			name: 'My App',
			spEntityId: 'urn:myapp:sp',
			acsUrl: 'https://app.example.com/saml/acs',
		};
		expect(dto.spEntityId).toBe('urn:myapp:sp');
		expect(dto.id).toBeUndefined();
	});

	it('accepts optional id', () => {
		const dto: SpConnectionStubDto = {
			id: 'sp-1',
			name: 'My App',
			spEntityId: 'urn:myapp:sp',
			acsUrl: 'https://app.example.com/saml/acs',
		};
		expect(dto.id).toBe('sp-1');
	});
});

describe('HealthResponse', () => {
	it('uses fixed ok status and service identifier', () => {
		const health: HealthResponse = { status: 'ok', service: 'nest-idp-api' };
		expect(health.status).toBe('ok');
		expect(health.service).toBe('nest-idp-api');
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
