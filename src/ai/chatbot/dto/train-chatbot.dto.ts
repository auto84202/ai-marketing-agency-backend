import { IsArray, IsObject } from 'class-validator';

export class TrainChatbotDto {
  @IsArray()
  trainingData!: Array<{
    input: string;
    output: string;
    intent?: string;
    context?: any;
  }>;
}
