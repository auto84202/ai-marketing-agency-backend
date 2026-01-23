import { IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum StatsPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly'
}

export class AdminStatsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(StatsPeriod)
  period?: StatsPeriod;
}

export interface SystemHealthDto {
  database: {
    status: 'healthy' | 'degraded' | 'down';
    responseTime: number;
    connections: number;
  };
  services: {
    [key: string]: {
      status: 'healthy' | 'degraded' | 'down';
      responseTime?: number;
      lastCheck: Date;
    };
  };
  system: {
    cpu: number;
    memory: number;
    disk: number;
    uptime: number;
  };
}
