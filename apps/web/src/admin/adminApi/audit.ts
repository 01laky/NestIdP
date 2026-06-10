import type { AuditEventListResponseDto } from '@nestidp/shared';
import { AUDIT_EVENTS_API_PATH } from '@nestidp/shared';
import { adminFetch } from './core';

export function listAuditEvents(
	params: Record<string, string> = {},
): Promise<AuditEventListResponseDto> {
	const query = new URLSearchParams(params);
	const suffix = query.size > 0 ? `?${query.toString()}` : '';
	return adminFetch<AuditEventListResponseDto>(`${AUDIT_EVENTS_API_PATH}${suffix}`);
}

export function auditExportUrl(params: Record<string, string>): string {
	const query = new URLSearchParams(params);
	return `${AUDIT_EVENTS_API_PATH}/export?${query.toString()}`;
}
