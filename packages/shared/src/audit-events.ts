export const AUDIT_EVENTS_API_PATH = '/api/admin/audit-events';

export const AUDIT_ROUTE_PREFIX = '/admin/audit';

export const AUDIT_EXPORT_MAX_ROWS = 10_000;

export const AUDIT_CATEGORIES = [
	'admin_auth',
	'admin_config',
	'end_user_auth',
	'saml',
	'sync',
	'identity',
] as const;

export type AuditCategoryLiteral = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_ACTOR_TYPES = ['admin', 'end_user', 'system'] as const;

export type AuditActorTypeLiteral = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_EXPORT_FORMATS = ['json', 'csv'] as const;

export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

export interface AuditEventDto {
	id: string;
	category: AuditCategoryLiteral;
	event: string;
	actorType: AuditActorTypeLiteral;
	actorId: string | null;
	actorLabel: string | null;
	subjectType: string | null;
	subjectId: string | null;
	clientIp: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

export interface AuditEventListResponseDto {
	items: AuditEventDto[];
	total: number;
	limit: number;
	offset: number;
}

export interface AuditEventExportJsonResponseDto {
	exportedAt: string;
	filters: Record<string, string | undefined>;
	items: AuditEventDto[];
	truncated?: boolean;
}

export interface ListAuditEventsQueryDto {
	limit?: number;
	offset?: number;
	category?: AuditCategoryLiteral;
	event?: string;
	actorType?: AuditActorTypeLiteral;
	subjectType?: string;
	subjectId?: string;
	since?: string;
	until?: string;
}

export interface ExportAuditEventsQueryDto extends ListAuditEventsQueryDto {
	format?: AuditExportFormat;
}
