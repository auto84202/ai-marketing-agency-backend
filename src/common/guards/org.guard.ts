import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class OrgGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private configService: ConfigService
    ) {}

    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();
        
        // Extract and verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('No token provided');
        }

        try {
            const token = authHeader.substring(7);
            const secret = this.configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure';
            const payload = this.jwtService.verify(token, { secret });
            
            // Attach user info to request
            req.user = payload;
            
            // Check if user is admin
            if (payload.role === 'ADMIN') {
                req.orgId = null;
                req.isAdmin = true;
                return true;
            }
            
            // For regular users, use their user ID as orgId
            // Check if x-org-id header is provided, otherwise use user's ID from token
            const orgId = req.headers["x-org-id"] || payload.sub;
            
            if (!orgId) {
                throw new UnauthorizedException('Organization ID required');
            }
            
            req.orgId = orgId;
            req.isAdmin = false;
            return true;
        } catch (error) {
            console.error('OrgGuard verification failed:', error);
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}