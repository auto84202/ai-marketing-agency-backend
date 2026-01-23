
import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private emailService: EmailService
  ) {}

  /**
   * Secure login implementation
   */
  async signIn(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ access_token: string; user: any }> {
    try {
      // Find user by email
      const user = await this.usersService.findByEmail(email);
      
      // Security: Always return same error message to prevent user enumeration
      if (!user || !user.password) {
        // Simulate password check timing to prevent timing attacks
        await bcrypt.compare(password, '$2a$10$dummy.hash.to.prevent.timing.attack');
        throw new UnauthorizedException('Invalid email or password');
      }

      // Check if account is active
      if (!user.isActive) {
        throw new UnauthorizedException('Account is deactivated. Please contact support.');
      }

      // Verify password with bcrypt
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Update last login time
      await this.usersService.updateLastLogin(user.id);

      // Log admin login attempts for security
      if (user.role === 'ADMIN') {
        console.log(`🔐 Admin login: ${email} at ${new Date().toISOString()} from ${ipAddress || 'unknown'}`);
        
        // Create audit log for admin login
        await this.createAuditLog({
          adminId: user.id,
          action: 'login',
          resource: 'auth',
          resourceId: user.id,
          newData: { email, loginTime: new Date().toISOString() },
          ipAddress: ipAddress || 'unknown',
          userAgent: userAgent || 'unknown'
        });
      }

      // Generate JWT token
      const payload: { sub: string; email: string; role: string } = { 
        sub: user.id, 
        email: user.email, 
        role: String(user.role) // Convert enum to string
      };
      
      // JWT expiresIn accepts string format like '7d', '24h', '1h' or number in seconds
      // Default to 1h (1 hour) for session timeout after inactivity
      const expiresIn: string | number = process.env.JWT_EXPIRES_IN || '1h';
      const access_token = await this.jwtService.signAsync(payload, {
        expiresIn,
      } as any);

      return {
        access_token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company: user.company,
          phone: user.phone,
          avatar: user.avatar,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
        }
      };
    } catch (error) {
      // Re-throw UnauthorizedException as-is
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      // Handle database errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Login error:', errorMessage);
      
      if (errorMessage.includes('connect') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('P1001')) {
        throw new UnauthorizedException('Service temporarily unavailable. Please try again later.');
      }
      
      throw new UnauthorizedException('Login failed. Please try again.');
    }
  }

  /**
   * Secure registration implementation
   */
  async register(registerDto: RegisterDto): Promise<any> {
    const { email, password, name, company, phone } = registerDto;

    // Note: Email and password validation is handled by RegisterDto class-validator decorators
    // The ValidationPipe will catch validation errors before reaching here

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if the email already exists
    const existingUser = await this.usersService.findByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictException('Email already registered. Please use a different email or try logging in.');
    }

    // Create and save the user (users service will hash the password)
    const user = await this.usersService.create({
      email: normalizedEmail,
      password, // Password will be hashed by users service
      name: name?.trim() || 'User',
      role: 'USER',
      company: company?.trim(),
      phone: phone?.trim(),
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user as any;
    return userWithoutPassword;
  }

  async validateOAuthUser(profile: any): Promise<any> {
    const { email, name, picture } = profile;
    
    console.log('OAuth profile received:', { email, name, picture });
    
    // Check if user exists
    let user = await this.usersService.findByEmail(email);
    
    if (!user) {
      console.log('User not found, creating new OAuth user');
      // Create new user for OAuth (seamless signup)
      user = await this.usersService.create({
        email,
        name: name || 'OAuth User',
        role: 'USER',
        avatar: picture,
        // No password for OAuth users - field is now optional
      });
      console.log('New OAuth user created:', user);
    } else {
      console.log('Existing user found:', user);
      // Update last login time for existing users
      await this.usersService.update(user.id, {
        lastLoginAt: new Date(),
        avatar: picture || user.avatar, // Update avatar if provided
      });
    }

    return user;
  }

  async generateJwtForOAuthUser(user: any): Promise<{ access_token: string; user: any }> {
    const payload: { sub: string; email: string; role: string } = { 
      sub: user.id, 
      email: user.email, 
      role: String(user.role) // Convert enum to string
    };
    // JWT expiresIn accepts string format like '7d', '24h', '1h' or number in seconds
    // Default to 2h (2 hours) to align with frontend inactivity timeout of 90 minutes
    const expiresIn: string | number = process.env.JWT_EXPIRES_IN || '2h';
    return {
      access_token: await this.jwtService.signAsync(payload, {
        expiresIn,
      } as any),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      }
    };
  }

  // Update user profile
  async getUserProfile(userId: string): Promise<any> {
    console.log('AuthService: Getting profile for user:', userId);
    
    const userProfile = await this.usersService.findOne(userId);
    console.log('AuthService: Profile retrieved successfully:', userProfile);
    
    return userProfile.data;
  }

  async updateProfile(userId: string, updateData: any): Promise<any> {
    console.log('AuthService: Updating profile for user:', userId);
    console.log('AuthService: Update data:', updateData);
    
    const updatedUser = await this.usersService.update(userId, updateData);
    console.log('AuthService: Profile updated successfully:', updatedUser);
    
    return {
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    };
  }

  // Admin-specific methods
  async createAdminUser(createAdminUserDto: any): Promise<any> {
    const { email, password, name, company, phone } = createAdminUserDto;

    // Check if the email already exists
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Create admin user with ADMIN role
    const user = await this.usersService.create({
      email,
      password,
      name: name || 'Admin User',
      role: 'ADMIN',
      company,
      phone,
    });

    return user;
  }

  async validateAdminUser(userId: string): Promise<boolean> {
    const user = await this.usersService.findOne(userId);
    return user && user.data && user.data.role === 'ADMIN' && user.data.isActive;
  }

  // Helper method to create audit logs
  private async createAuditLog(data: any) {
    try {
      await (this.prisma as any).adminAuditLog.create({
        data: {
          ...data,
          createdAt: new Date()
        }
      });
    } catch (error) {
      // Don't fail login if audit logging fails
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Secure forgot password implementation
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Check if user exists (normalize email)
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    
    // Security: Always return same message to prevent user enumeration
    // Even if user doesn't exist, we return success message
    if (user) {
      // Delete any existing unused tokens for this user
      await this.prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          used: false,
        }
      });

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

      // Store reset token in database
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: resetToken,
          expiresAt,
        }
      });

      // Build reset link
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetLink = `${frontendUrl}/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
      
      // Send password reset email
      try {
        await this.emailService.sendPasswordResetEmail(user.email, resetLink, user.name || undefined);
      } catch (emailError) {
        console.error(`Failed to send password reset email to ${email}:`, emailError);
        // Don't fail the request if email fails - log it for debugging
        // In production, you might want to queue this for retry
      }
    }

    // Always return same message for security
    return { 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    };
  }

  /**
   * Secure reset password implementation
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { email, token, newPassword } = resetPasswordDto;

    // Validate inputs
    if (!token || !email || !newPassword) {
      throw new BadRequestException('Token, email, and new password are required');
    }

    // Validate password strength
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Find user (normalize email)
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find valid reset token
    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        token: token.trim(),
        used: false,
        expiresAt: {
          gt: new Date() // Token not expired
        }
      }
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid, expired, or already used reset token. Please request a new password reset.');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Mark token as used
    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true }
    });

    // Delete all other unused tokens for this user
    await this.prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        used: false,
      }
    });

    return { message: 'Password has been reset successfully. You can now log in with your new password.' };
  }

  // Debug method to check users (remove in production)
  async getUsersForDebug() {
    return this.usersService.findAll();
  }

}
