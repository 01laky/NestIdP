import { IsIn } from 'class-validator';
import type { RemoveSourceIdentitiesMode } from '@nestidp/shared';

export class RemoveSourceIdentitiesBodyDto {
	@IsIn(['deactivate', 'delete'])
	mode!: RemoveSourceIdentitiesMode;
}
