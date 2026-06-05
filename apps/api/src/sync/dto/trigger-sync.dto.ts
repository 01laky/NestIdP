import { IsBoolean, IsOptional } from 'class-validator';

export class TriggerSyncBodyDto {
	@IsOptional()
	@IsBoolean()
	dryRun?: boolean;
}
