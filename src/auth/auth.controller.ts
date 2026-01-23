
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Request,
  UseGuards,
  Res,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import * as crypto from 'crypto';
// import {Request} from "express";

// interface AuthenticatedRequest extends Request {
//   user: any;
// }
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Login endpoint - Secure authentication
   */
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signIn(@Body() signInDto: LoginDto, @Request() req: any) {
    try {
      const result = await this.authService.signIn(
        signInDto.email?.trim()?.toLowerCase(),
        signInDto.password,
        req.ip,
        req.headers['user-agent']
      );
      return {
        success: true,
        ...result
      };
    } catch (error) {
      // Ensure proper error response format
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Login failed. Please check your credentials.');
    }
  }

  /**
   * Registration endpoint - Secure user signup
   */
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    try {
      const user = await this.authService.register(registerDto);
      return {
        success: true,
        message: "User registered successfully",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      };
    } catch (error) {
      // Re-throw to let NestJS ValidationPipe handle validation errors
      // NestJS will automatically format validation errors
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Registration failed. Please try again.');
    }
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  async getProfile(@Request() request: any) {
    // Get detailed user information instead of just JWT payload
    const userDetails = await this.authService.getUserProfile(request.user.sub);
    return {
      ...request.user,
      ...userDetails
    };
  }

  @UseGuards(AuthGuard)
  @Patch('profile')
  async updateProfile(@Request() request: any, @Body() updateData: any) {
    console.log('Updating profile for user:', request.user.sub);
    console.log('Update data:', updateData);
    return this.authService.updateProfile(request.user.sub, updateData);
  }

  @UseGuards(AuthGuard)
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = path.join(process.cwd(), 'uploads', 'avatars');
          // Create directory if it doesn't exist
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueName = `${crypto.randomBytes(16).toString('hex')}-${Date.now()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new BadRequestException('Only image files are allowed!'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(@Request() request: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const userId = request.user.sub;
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    
    // Update user profile with avatar URL
    const updatedUser = await this.authService.updateProfile(userId, { avatar: avatarUrl });
    
    return {
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl,
      user: updatedUser.user,
    };
  }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    const result = await this.authService.forgotPassword(forgotPasswordDto);
    return {
      success: true,
      ...result
    };
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const result = await this.authService.resetPassword(resetPasswordDto);
    return {
      success: true,
      ...result
    };
  }

  // Debug endpoint to check users (remove in production)
  @Get('debug/users')
  async getUsers() {
    return this.authService.getUsersForDebug();
  }

  // Google OAuth endpoints
  @Get('google')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuth(@Req() req: any) {
    // Initiates Google OAuth flow
  }

  @Get('google/callback')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    try {
      console.log('Google OAuth callback received:', req.user);
      
      const user = await this.authService.validateOAuthUser(req.user);
      console.log('OAuth user validated:', user);
      
      const result = await this.authService.generateJwtForOAuthUser(user);
      console.log('JWT generated for OAuth user');
      
      // Redirect to frontend with token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${result.access_token}&user=${encodeURIComponent(JSON.stringify(result.user))}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/login?error=oauth_failed`);
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  health() {
    return { ok: true, message: 'Server is running', timestamp: new Date().toISOString() };
  }

}
