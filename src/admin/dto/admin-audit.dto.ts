import { IsOptional, IsString, IsDateString, IsEnum, IsObject } from 'class-validator';

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  EXPORT = 'export',
  IMPORT = 'import',
  BULK_UPDATE = 'bulk_update',
  BULK_DELETE = 'bulk_delete'
}

export enum AuditResource {
  USER = 'user',
  CAMPAIGN = 'campaign',
  CLIENT = 'client',
  CHATBOT = 'chatbot',
  REPORT = 'report',
  BILLING = 'billing',
  SYSTEM = 'system'
}

export class CreateAuditLogDto {
  @IsString()
  adminId!: string;

  @IsEnum(AuditAction)
  action!: AuditAction;

  @IsEnum(AuditResource)
  resource!: AuditResource;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsObject()
  oldData?: any;

  @IsOptional()
  @IsObject()
  newData?: any;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  adminId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditResource)
  resource?: AuditResource;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
