import { describe, expect, it } from 'vitest';
import {
	AUDIT_ACTOR_TYPES,
	AUDIT_CATEGORIES,
	AUDIT_EVENTS_API_PATH,
	AUDIT_EXPORT_FORMATS,
	AUDIT_EXPORT_MAX_ROWS,
	AUDIT_ROUTE_PREFIX,
	type AuditEventDto,
	type AuditEventExportJsonResponseDto,
	type AuditEventListResponseDto,
	type ExportAuditEventsQueryDto,
	type ListAuditEventsQueryDto,
} from './audit-events.js';

describe('audit-events shared types', () => {
	it('SH-AUD-01: AUDIT_EVENTS_API_PATH is /api/admin/audit-events', () => {
		expect(AUDIT_EVENTS_API_PATH).toBe('/api/admin/audit-events');
	});

	it('SH-AUD-02: AUDIT_ROUTE_PREFIX is /admin/audit', () => {
		expect(AUDIT_ROUTE_PREFIX).toBe('/admin/audit');
	});

	it('SH-AUD-03: AUDIT_EXPORT_MAX_ROWS is 10000', () => {
		expect(AUDIT_EXPORT_MAX_ROWS).toBe(10_000);
	});

	it('SH-AUD-04: AUDIT_CATEGORIES includes admin_auth and sync', () => {
		expect(AUDIT_CATEGORIES).toContain('admin_auth');
		expect(AUDIT_CATEGORIES).toContain('admin_config');
		expect(AUDIT_CATEGORIES).toContain('end_user_auth');
		expect(AUDIT_CATEGORIES).toContain('saml');
		expect(AUDIT_CATEGORIES).toContain('sync');
		expect(AUDIT_CATEGORIES).toContain('identity');
		expect(AUDIT_CATEGORIES).toHaveLength(6);
	});

	it('SH-AUD-05: AUDIT_ACTOR_TYPES includes admin, end_user, system', () => {
		expect(AUDIT_ACTOR_TYPES).toEqual(['admin', 'end_user', 'system']);
	});

	it('SH-AUD-06: AUDIT_EXPORT_FORMATS includes json and csv', () => {
		expect(AUDIT_EXPORT_FORMATS).toEqual(['json', 'csv']);
	});

	it('SH-AUD-07: AuditEventDto shape smoke', () => {
		const dto: AuditEventDto = {
			id: 'evt-1',
			category: 'admin_auth',
			event: 'admin_login_success',
			actorType: 'admin',
			actorId: 'a1',
			actorLabel: 'admin',
			subjectType: null,
			subjectId: null,
			clientIp: '127.0.0.1',
			metadata: null,
			createdAt: '2026-01-01T00:00:00.000Z',
		};
		expect(dto.category).toBe('admin_auth');
		expect(dto.metadata).toBeNull();
	});

	it('SH-AUD-08: AuditEventListResponseDto pagination fields', () => {
		const dto: AuditEventListResponseDto = {
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		};
		expect(dto.limit).toBe(50);
		expect(dto.items).toEqual([]);
	});

	it('SH-AUD-09: AuditEventExportJsonResponseDto includes filters and exportedAt', () => {
		const dto: AuditEventExportJsonResponseDto = {
			exportedAt: '2026-01-01T00:00:00.000Z',
			filters: { category: 'sync' },
			items: [],
			truncated: false,
		};
		expect(dto.filters.category).toBe('sync');
		expect(dto.truncated).toBe(false);
	});

	it('SH-AUD-10: ListAuditEventsQueryDto optional filters', () => {
		const query: ListAuditEventsQueryDto = {
			limit: 25,
			offset: 10,
			category: 'saml',
			event: 'saml_sso_success',
			since: '2026-01-01T00:00:00.000Z',
			until: '2026-12-31T23:59:59.999Z',
		};
		expect(query.category).toBe('saml');
		expect(query.since).toContain('2026');
	});

	it('SH-AUD-11: ExportAuditEventsQueryDto extends list with format', () => {
		const query: ExportAuditEventsQueryDto = {
			format: 'csv',
			category: 'admin_config',
		};
		expect(query.format).toBe('csv');
	});

	it('SH-AUD-12: API path and route prefix differ', () => {
		expect(AUDIT_EVENTS_API_PATH).not.toBe(AUDIT_ROUTE_PREFIX);
		expect(AUDIT_EVENTS_API_PATH.startsWith('/api/')).toBe(true);
		expect(AUDIT_ROUTE_PREFIX.startsWith('/admin/')).toBe(true);
	});
});
