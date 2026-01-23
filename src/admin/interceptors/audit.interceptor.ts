import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AdminService } from '../admin.service';
import { AuditAction, AuditResource } from '../dto/admin-audit.dto';

export interface AuditData {
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  oldData?: any;
  newData?: any;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private adminService: AdminService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Only audit admin actions
    if (!user || user.role !== 'ADMIN') {
      return next.handle();
    }

    const auditData: AuditData = this.extractAuditData(context, request);

    return next.handle().pipe(
      tap((response) => {
        // Log the audit trail asynchronously
        this.logAuditTrail(user.sub, auditData, request, response);
      }),
    );
  }

  private extractAuditData(context: ExecutionContext, request: any): AuditData {
    const method = request.method;
    const url = request.url;
    const body = request.body;
    const params = request.params;

    // Determine action based on HTTP method and URL
    let action: AuditAction;
    let resource: AuditResource;
    let resourceId: string | undefined;

    // Extract resource ID from params
    resourceId = params.id || params.userId || params.campaignId || params.clientId;

    // Map HTTP methods to audit actions
    switch (method) {
      case 'POST':
        action = AuditAction.CREATE;
        break;
      case 'PUT':
      case 'PATCH':
        action = AuditAction.UPDATE;
        break;
      case 'DELETE':
        action = AuditAction.DELETE;
        break;
      default:
        action = AuditAction.CREATE; // Default fallback
    }

    // Map URL patterns to resources
    if (url.includes('/users') || url.includes('/admin/users')) {
      resource = AuditResource.USER;
    } else if (url.includes('/campaigns')) {
      resource = AuditResource.CAMPAIGN;
    } else if (url.includes('/clients')) {
      resource = AuditResource.CLIENT;
    } else if (url.includes('/chatbots')) {
      resource = AuditResource.CHATBOT;
    } else if (url.includes('/reports')) {
      resource = AuditResource.REPORT;
    } else if (url.includes('/billing') || url.includes('/invoices')) {
      resource = AuditResource.BILLING;
    } else {
      resource = AuditResource.SYSTEM;
    }

    return {
      action,
      resource,
      resourceId,
      newData: body,
    };
  }

  private async logAuditTrail(
    adminId: string,
    auditData: AuditData,
    request: any,
    response: any,
  ) {
    try {
      await this.adminService.createAuditLog({
        adminId,
        action: auditData.action,
        resource: auditData.resource,
        resourceId: auditData.resourceId,
        oldData: auditData.oldData,
        newData: auditData.newData,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error('Failed to create audit log:', error);
    }
  }
}
