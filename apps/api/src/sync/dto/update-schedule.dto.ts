import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

/**
 * PATCH body for a connection's schedule. Omitted fields are unchanged; an explicit `null`
 * `scheduleCron`/`scheduleTimezone` clears that value. Cron/timezone semantics are validated in the
 * service via the shared `validateCronSchedule` helper (this DTO only enforces shape/length).
 */
export class UpdateScheduleBodyDto {
	@IsOptional()
	@IsBoolean()
	scheduleEnabled?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Trim()
	@IsString()
	@MaxLength(256)
	scheduleCron?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Trim()
	@IsString()
	@MaxLength(128)
	scheduleTimezone?: string | null;

	@IsOptional()
	@IsBoolean()
	schedulePaused?: boolean;

	@IsOptional()
	@IsBoolean()
	scheduleDryRun?: boolean;
}
