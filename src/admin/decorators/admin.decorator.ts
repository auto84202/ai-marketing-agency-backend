import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminUser } from '../types/admin.types';

export const CurrentAdmin = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AdminUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

export const AdminAudit = createParamDecorator(
  (data: { action: string; resource: string }, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return {
      adminId: request.user?.sub,
      action: data.action,
      resource: data.resource,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  },
);
