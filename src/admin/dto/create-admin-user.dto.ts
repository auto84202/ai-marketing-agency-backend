import { IsEmail, IsString, IsOptional, MinLength, Matches, MaxLength, IsEnum, IsArray } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateAdminUserDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, {
    message: 'Please provide a valid email address format'
  })
  email?: string;

  @IsString({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  })
  password?: string;

  @IsString({ message: 'Name is required' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Name must not exceed 50 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Company name must not exceed 100 characters' })
  company?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+]?[\d\s\-\(\)]{10,15}$/, {
    message: 'Please provide a valid phone number'
  })
  phone?: string;

  @IsEnum(Role, { message: 'Role must be a valid role' })
  role?: Role;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}