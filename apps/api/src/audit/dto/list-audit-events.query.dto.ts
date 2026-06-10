import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AUDIT_ACTOR_TYPES, AUDIT_CATEGORIES, AUDIT_EXPORT_FORMATS } from '@nestidp/shared';
import { Trim } from '../../common/decorators/trim.decorator';

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
	@IsIn([...AUDIT_ACTOR_TYPES])
	actorType?: (typeof AUDIT_ACTOR_TYPES)[number];

	@IsOptional()
	@Trim()
	@IsString()
	@MaxLength(100)
	subjectType?: string;

	@IsOptional()
	@Trim()
	@IsString()
	@MaxLength(200)
	subjectId?: string;

	// §5.C: garbage dates previously flowed into `new Date(...)` → Invalid Date in the Prisma filter.
	@IsOptional()
	@IsISO8601()
	since?: string;

	@IsOptional()
	@IsISO8601()
	until?: string;
}

export class ExportAuditEventsQueryDto extends ListAuditEventsQueryDto {
	@IsOptional()
	@IsIn([...AUDIT_EXPORT_FORMATS])
	format?: (typeof AUDIT_EXPORT_FORMATS)[number];
}
