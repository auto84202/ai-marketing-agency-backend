
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('Authentication required. Please log in.');
    }
    
    try {
      const secret = this.configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure';
      const payload = jwt.verify(token, secret) as any;
      
      // Attach user payload to request for use in route handlers
      // Map 'sub' to 'id' for consistency (JWT standard uses 'sub' for user ID)
      request['user'] = {
        id: payload.sub || payload.id,
        email: payload.email,
        role: payload.role,
        ...payload
      };
      return true;
    } catch (error) {
      console.error('JWT verification failed:', error);
      throw new UnauthorizedException('Invalid or expired token. Please log in again.');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

// Export alias for compatibility with new modules
export const JwtAuthGuard = AuthGuard;
