import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';

export class TerminateBulkBodyDto {
	@IsArray()
	@ArrayNotEmpty()
	@ArrayMaxSize(500)
	@IsString({ each: true })
	@MaxLength(64, { each: true })
	ids!: string[];
}
