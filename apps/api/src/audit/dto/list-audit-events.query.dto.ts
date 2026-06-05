import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AUDIT_CATEGORIES, AUDIT_EXPORT_FORMATS } from '@nestidp/shared';

export class ListAuditEventsQueryDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	offset?: number;

	@IsOptional()
	@IsIn([...AUDIT_CATEGORIES])
	category?: (typeof AUDIT_CATEGORIES)[number];

	@IsOptional()
	@IsString()
	event?: string;

	@IsOptional()
	@IsString()
	since?: string;

	@IsOptional()
	@IsString()
	until?: string;
}

export class ExportAuditEventsQueryDto extends ListAuditEventsQueryDto {
	@IsOptional()
	@IsIn([...AUDIT_EXPORT_FORMATS])
	format?: (typeof AUDIT_EXPORT_FORMATS)[number];
}
