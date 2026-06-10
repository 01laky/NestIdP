import { PartialType } from '@nestjs/mapped-types';
import { CreateSpConnectionBodyDto } from './create-sp-connection.dto';

/**
 * Update body = the create body with every field optional (Prompt 38 §6.3 / §A11). `PartialType` inherits
 * each property's validators (so a supplied value is still trimmed/length-checked/non-empty) and adds
 * `@IsOptional()`, exactly reproducing the previously hand-maintained copy.
 */
export class UpdateSpConnectionBodyDto extends PartialType(CreateSpConnectionBodyDto) {}
