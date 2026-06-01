import { describe, expect, it } from 'vitest';
import {
	AUTH_TYPES,
	isAuthType,
	isLastSyncStatus,
	isSyncLogStatus,
	LAST_SYNC_STATUSES,
	SYNC_LOG_STATUSES,
} from './schema-enums.js';

describe('schema-enums', () => {
	it('SH-ENUM-01: AUTH_TYPES values are uppercase strings', () => {
		for (const value of AUTH_TYPES) {
			expect(value).toBe(value.toUpperCase());
			expect(typeof value).toBe('string');
		}
	});

	it('SH-ENUM-02: LAST_SYNC_STATUSES includes NEVER as default semantic', () => {
		expect(LAST_SYNC_STATUSES).toContain('NEVER');
		expect(LAST_SYNC_STATUSES[0]).toBe('NEVER');
	});

	it('SH-ENUM-03: SYNC_LOG_STATUSES has exactly RUNNING, SUCCESS, FAILED', () => {
		expect(SYNC_LOG_STATUSES).toEqual(['RUNNING', 'SUCCESS', 'FAILED']);
	});

	it('SH-ENUM-04: validators reject unknown status strings', () => {
		expect(isAuthType('BEARER')).toBe(true);
		expect(isAuthType('oauth')).toBe(false);
		expect(isLastSyncStatus('NEVER')).toBe(true);
		expect(isLastSyncStatus('PENDING')).toBe(false);
		expect(isSyncLogStatus('RUNNING')).toBe(true);
		expect(isSyncLogStatus('CANCELLED')).toBe(false);
	});

	it('SH-ENUM-05: validators reject empty string', () => {
		expect(isAuthType('')).toBe(false);
		expect(isLastSyncStatus('')).toBe(false);
		expect(isSyncLogStatus('')).toBe(false);
	});

	it('SH-ENUM-06: validators reject lowercase enum values', () => {
		expect(isAuthType('bearer')).toBe(false);
		expect(isLastSyncStatus('never')).toBe(false);
		expect(isSyncLogStatus('running')).toBe(false);
	});

	it('SH-ENUM-07: AUTH_TYPES has exactly one v1 value', () => {
		expect(AUTH_TYPES).toEqual(['BEARER']);
	});
});
