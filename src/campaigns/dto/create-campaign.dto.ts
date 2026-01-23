import { CampaignType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CampaignBusinessProfileDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  primaryProductOrService?: string;

  @IsOptional()
  @IsString()
  brandVoice?: string;

  @IsOptional()
  @IsString()
  uniqueValueProp?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

export class CampaignAudienceProfileDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  demographics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painPoints?: string[];
}

export class CreateCampaignDto {
  @IsOptional()
  @IsString()
  userId?: string; // DEPRECATED: Ignored for security - always uses authenticated user's ID from JWT token

  @IsString()
  name!: string;

  @IsEnum(CampaignType)
  type!: CampaignType;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsString()
  @IsNotEmpty({ message: 'Campaign description is required for AI content generation' })
  description!: string; // Required for automatic content generation

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  budget?: number; // Changed from IsInt to IsNumber to accept decimal values

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignBusinessProfileDto)
  businessProfile?: CampaignBusinessProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignAudienceProfileDto)
  audienceProfile?: CampaignAudienceProfileDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  focusKeywords?: string[];

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}
