import { IsString, IsInt, IsEnum, Min, Max, IsOptional } from 'class-validator';
import { SocialPlatform } from '@prisma/client';

export class CreateScraperJobDto {
    @IsEnum(SocialPlatform)
    platform!: SocialPlatform;

    @IsString()
    keyword!: string;

    @IsInt()
    @Min(1)
    @Max(10)
    googlePages: number = 2;

    @IsInt()
    @Min(1)
    @Max(50)
    replyLimit: number = 5;

    @IsString()
    @IsOptional()
    groqApiKey?: string;
}
