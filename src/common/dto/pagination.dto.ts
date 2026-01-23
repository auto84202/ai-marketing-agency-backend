import { IsInt, IsOptional, IsString, Min } from "class-validator";


export class PaginationDto {
@IsInt()
@Min(0)
@IsOptional()
skip?: number = 0;


@IsInt()
@Min(1)
@IsOptional()
take?: number = 20;


@IsString()
@IsOptional()
q?: string;
}