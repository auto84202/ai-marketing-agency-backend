import { IsString, IsOptional, IsArray, IsUUID } from 'class-validator';

export class CreateAdminPermissionDto {
  @IsString({ message: 'Permission name is required' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString({ message: 'Resource is required' })
  resource!: string;

  @IsString({ message: 'Action is required' })
  action!: string;
}

export class UpdateAdminPermissionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsString()
  action?: string;
}

export class CreateAdminRoleDto {
  @IsString({ message: 'Role name is required' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsUUID(4, { each: true })
  permissionIds!: string[];

  @IsOptional()
  isDefault?: boolean;
}

export class UpdateAdminRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  permissionIds?: string[];

  @IsOptional()
  isDefault?: boolean;
}
