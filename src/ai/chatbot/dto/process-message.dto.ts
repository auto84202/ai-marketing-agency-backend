import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class ProcessMessageDto {
  @IsString()
  message!: string;

  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsArray()
  previousMessages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsArray()
  entities?: any[];
}
