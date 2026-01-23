import { IsString, IsOptional, IsEnum, IsArray, IsObject } from 'class-validator';

export enum ContentType {
  BLOG = 'blog',
  AD_COPY = 'ad_copy',
  EMAIL = 'email',
  PRODUCT_DESCRIPTION = 'product_description',
  VIDEO_SCRIPT = 'video_script',
  CAPTION = 'caption',
  HEADLINE = 'headline',
}

export enum ContentTone {
  PROFESSIONAL = 'professional',
  CASUAL = 'casual',
  FRIENDLY = 'friendly',
  AUTHORITATIVE = 'authoritative',
}

export enum ContentLength {
  SHORT = 'short',
  MEDIUM = 'medium',
  LONG = 'long',
}

export enum ContentStyle {
  INFORMATIVE = 'informative',
  PERSUASIVE = 'persuasive',
  ENTERTAINING = 'entertaining',
  EDUCATIONAL = 'educational',
}

export class GenerateContentDto {
  @IsEnum(ContentType)
  type!: ContentType;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsEnum(ContentTone)
  tone?: ContentTone;

  @IsOptional()
  @IsEnum(ContentLength)
  length?: ContentLength;

  @IsOptional()
  @IsEnum(ContentStyle)
  style?: ContentStyle;

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
  @IsString()
  title?: string;

  @IsOptional()
  @IsObject()
  options?: any;
}
