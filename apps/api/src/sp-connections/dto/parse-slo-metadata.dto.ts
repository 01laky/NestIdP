import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ParseSloMetadataBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(262144)
	metadataXml!: string;
}
