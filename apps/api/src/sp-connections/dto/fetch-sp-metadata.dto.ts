import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FetchSpMetadataBodyDto {
	// The URL format (absolute, http/https) is validated in the service so it can return a typed,
	// localizable error; here we only bound the raw string.
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	url!: string;
}
