import { PartialType } from '@nestjs/mapped-types';
import { CreateAdminUserDto } from './create-admin-user.dto';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateAdminUserDto extends PartialType(CreateAdminUserDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}