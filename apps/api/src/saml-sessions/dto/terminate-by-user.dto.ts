import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TerminateByUserBodyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(64)
	userId!: string;
}
