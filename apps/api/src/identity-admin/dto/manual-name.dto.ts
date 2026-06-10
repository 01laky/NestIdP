import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

export class ManualNameBodyDto {
	@Trim()
	@IsString()
	@MinLength(1)
	@MaxLength(128)
	name!: string;
}
