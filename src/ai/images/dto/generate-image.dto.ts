import { IsString, IsOptional, IsEnum, IsNumber, IsUrl, Min, Max } from 'class-validator';

export enum ImageSize {
  SMALL = '256x256',
  MEDIUM = '512x512',
  LARGE = '1024x1024',
  LANDSCAPE = '1792x1024',
  PORTRAIT = '1024x1792',
}

export enum ImageQuality {
  STANDARD = 'standard',
  HD = 'hd',
}

export enum ImageStyle {
  VIVID = 'vivid',
  NATURAL = 'natural',
}

export enum ImageUseCase {
  SOCIAL_MEDIA = 'social_media',
  AD_BANNER = 'ad_banner',
  PRODUCT_MOCKUP = 'product_mockup',
  BLOG_HEADER = 'blog_header',
  EMAIL_BANNER = 'email_banner',
}

export enum ImageStyleType {
  MINIMALIST = 'minimalist',
  VINTAGE = 'vintage',
  MODERN = 'modern',
  CORPORATE = 'corporate',
  CREATIVE = 'creative',
  PHOTOREALISTIC = 'photorealistic',
}

export class GenerateImageDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @IsOptional()
  @IsEnum(ImageQuality)
  quality?: ImageQuality;

  @IsOptional()
  @IsEnum(ImageStyle)
  style?: ImageStyle;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  n?: number;

  @IsOptional()
  @IsString()
  user?: string;
}

export class GenerateMarketingImageDto {
  @IsEnum(ImageUseCase)
  useCase!: ImageUseCase;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  brandStyle?: string;

  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @IsOptional()
  @IsEnum(ImageQuality)
  quality?: ImageQuality;

  @IsOptional()
  @IsEnum(ImageStyle)
  style?: ImageStyle;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  n?: number;
}

export class GenerateStyledImageDto {
  @IsString()
  prompt!: string;

  @IsEnum(ImageStyleType)
  style!: ImageStyleType;

  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @IsOptional()
  @IsEnum(ImageQuality)
  quality?: ImageQuality;

  @IsOptional()
  @IsEnum(ImageStyle)
  styleType?: ImageStyle;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  n?: number;
}

export class CreateImageVariationDto {
  @IsUrl()
  imageUrl!: string;

  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4)
  n?: number;

  @IsOptional()
  @IsString()
  user?: string;
}

export class EditImageDto {
  @IsUrl()
  imageUrl!: string;

  @IsUrl()
  maskUrl!: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4)
  n?: number;

  @IsOptional()
  @IsString()
  user?: string;
}
