import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateApiConnectionBodyDto } from './create-api-connection.dto';

/**
 * Update body = the create body with every field optional (Prompt 38 §6.3 / §A11), plus the update-only
 * `acknowledgeRebind` flag. `PartialType` inherits each property's validators (trim / length / enum /
 * non-empty) and adds `@IsOptional()`, reproducing the previously hand-maintained copy.
 */
export class UpdateApiConnectionBodyDto extends PartialType(CreateApiConnectionBodyDto) {
	/** Confirms an intentional base-URL/auth rebind that would otherwise be refused. */
	@IsOptional()
	@IsBoolean()
	acknowledgeRebind?: boolean;
}
