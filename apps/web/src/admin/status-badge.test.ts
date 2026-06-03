import { describe, expect, it } from 'vitest';
import {
	activeFlagToBadge,
	certStatusLabel,
	certStatusToBadge,
	identityOriginLabel,
	identityOriginToBadge,
	lastSyncStatusToBadge,
	syncLogStatusToBadge,
} from './status-badge';

describe('status-badge', () => {
	it('WEB-EVG-20: syncLogStatusToBadge SUCCESS → success', () => {
		expect(syncLogStatusToBadge('SUCCESS')).toBe('success');
	});

	it('WEB-EVG-21: syncLogStatusToBadge FAILED → danger', () => {
		expect(syncLogStatusToBadge('FAILED')).toBe('danger');
	});

	it('WEB-EVG-22: lastSyncStatusToBadge IN_PROGRESS → info', () => {
		expect(lastSyncStatusToBadge('IN_PROGRESS')).toBe('info');
	});

	it('WEB-EVG-22b: lastSyncStatusToBadge NEVER → neutral', () => {
		expect(lastSyncStatusToBadge('NEVER')).toBe('neutral');
	});

	it('WEB-EVG-22c: syncLogStatusToBadge RUNNING → info', () => {
		expect(syncLogStatusToBadge('RUNNING')).toBe('info');
	});

	it('WEB-EVG-23: certStatusToBadge maps dashboard certStatus values', () => {
		expect(certStatusToBadge('ok')).toBe('success');
		expect(certStatusToBadge('missing')).toBe('danger');
		expect(certStatusToBadge('expiring_soon')).toBe('warning');
		expect(certStatusToBadge('rotation_active')).toBe('info');
		expect(certStatusLabel('missing')).toBe('No signing cert');
		expect(certStatusLabel('rotation_active')).toBe('Rotation in progress');
	});

	it('WEB-EVG-47: unknown sync log status maps to neutral', () => {
		expect(syncLogStatusToBadge('PARTIAL')).toBe('neutral');
		expect(syncLogStatusToBadge('')).toBe('neutral');
	});

	it('WEB-EVG-48: lastSyncStatus covers SUCCESS and FAILED', () => {
		expect(lastSyncStatusToBadge('SUCCESS')).toBe('success');
		expect(lastSyncStatusToBadge('FAILED')).toBe('danger');
		expect(lastSyncStatusToBadge('UNKNOWN')).toBe('neutral');
	});

	it('WEB-EVG-49: activeFlagToBadge maps boolean active flag', () => {
		expect(activeFlagToBadge(true)).toBe('success');
		expect(activeFlagToBadge(false)).toBe('danger');
	});

	it('WEB-EVG-50: certStatusLabel falls back to raw string for unknown status', () => {
		expect(certStatusLabel('custom_status')).toBe('custom_status');
		expect(certStatusToBadge('custom_status')).toBe('neutral');
	});

	it('WEB-IDN-MAN-10: identityOriginToBadge and label for manual vs synced', () => {
		expect(identityOriginToBadge('manual')).toBe('info');
		expect(identityOriginToBadge('synced')).toBe('neutral');
		expect(identityOriginLabel('manual')).toBe('Manual');
		expect(identityOriginLabel('synced')).toBe('Synced');
	});
});
