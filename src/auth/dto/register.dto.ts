import { IsEmail, IsString, IsOptional, MinLength, Matches, MaxLength, IsNotEmpty, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.trim()?.toLowerCase())
  email!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
  })
  password!: string;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Name must not exceed 50 characters' })
  @Transform(({ value }) => value?.trim())
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Company name must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim() || undefined)
  company?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  })
  @ValidateIf((o) => o.phone !== undefined && o.phone !== null && o.phone !== '')
  @IsString({ message: 'Phone must be a string' })
  @Matches(/^[+]?[\d\s\-\(\)]{10,15}$/, {
    message: 'Please provide a valid phone number'
  })
  phone?: string;
}