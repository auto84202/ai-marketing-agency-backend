import { IsArray, IsString, IsOptional, IsObject } from 'class-validator';

export class GenerateSEODto {
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsString()
  contentType!: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  options?: any;
}
