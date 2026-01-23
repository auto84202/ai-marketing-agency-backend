import { IsString, IsOptional, IsEnum, IsObject, IsArray } from 'class-validator';

export enum ChatbotPersonality {
  PROFESSIONAL = 'professional',
  FRIENDLY = 'friendly',
  CASUAL = 'casual',
  EXPERT = 'expert',
}

export class CreateChatbotDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @IsOptional()
  @IsEnum(ChatbotPersonality)
  personality?: ChatbotPersonality;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsArray()
  capabilities?: string[];

  @IsOptional()
  @IsObject()
  trainingData?: any;

  @IsOptional()
  @IsObject()
  config?: any;
}
