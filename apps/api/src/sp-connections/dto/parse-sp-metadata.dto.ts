import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ParseSpMetadataBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(262144)
	metadataXml!: string;
}
