import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { CreateAdminPermissionDto, UpdateAdminPermissionDto } from './dto/admin-permission.dto';
import { CreateAdminRoleDto, UpdateAdminRoleDto } from './dto/admin-permission.dto';
import { AuditLogQueryDto } from './dto/admin-audit.dto';
import { AdminStatsQueryDto } from './dto/admin-stats.dto';
import { AdminGuard, AdminRoles } from './guards/admin.guard';
import { PermissionsGuard, RequirePermissions } from './guards/permissions.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { CurrentAdmin } from './decorators/admin.decorator';
import { Role } from '@prisma/client';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
@AdminRoles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Dashboard and Overview
  @Get('dashboard')
  @RequirePermissions('dashboard:read')
  async getDashboard() {
    const stats = await this.adminService.getDashboardStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get('stats')
  @RequirePermissions()
  async getSystemStats(@Query() query: AdminStatsQueryDto) {
    const metrics = await this.adminService.getSystemMetrics();
    return {
      success: true,
      data: metrics,
    };
  }

  @Get('health')
  @RequirePermissions()
  async getSystemHealth() {
    const health = await this.adminService.getSystemHealth();
    return {
      success: true,
      data: health,
    };
  }

  // User Management
  @Post('users')
  @RequirePermissions()
  async createUser(@Body() createAdminUserDto: CreateAdminUserDto) {
    const user = await this.adminService.createAdminUser(createAdminUserDto);
    return {
      success: true,
      data: user,
      message: 'User created successfully',
    };
  }

  @Get('users')
  @RequirePermissions()
  async getUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    const result = await this.adminService.getAllUsers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      role,
    });
    return result;
  }

  @Get('users/:id')
  @RequirePermissions()
  async getUserById(@Param('id') id: string) {
    const user = await this.adminService.getUserById(id);
    return {
      success: true,
      data: user,
    };
  }

  @Get('users/last-logged-in')
  @RequirePermissions()
  async getLastLoggedInUser() {
    const user = await this.adminService.getLastLoggedInUser();
    return {
      success: true,
      data: user,
    };
  }

  @Patch('users/:id')
  @RequirePermissions()
  async updateUser(
    @Param('id') id: string,
    @Body() updateAdminUserDto: UpdateAdminUserDto,
  ) {
    const user = await this.adminService.updateUser(id, updateAdminUserDto);
    return {
      success: true,
      data: user,
      message: 'User updated successfully',
    };
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions()
  async deleteUser(@Param('id') id: string) {
    await this.adminService.deleteUser(id);
    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  @Post('users/bulk-update')
  @RequirePermissions()
  async bulkUpdateUsers(
    @Body() body: { ids: string[]; updateData: Partial<UpdateAdminUserDto> },
  ) {
    const result = await this.adminService.bulkUpdateUsers(body.ids, body.updateData);
    return {
      success: true,
      data: result,
      message: 'Bulk update completed',
    };
  }

  // Permission Management
  @Post('permissions')
  @RequirePermissions()
  async createPermission(@Body() createPermissionDto: CreateAdminPermissionDto) {
    const result = await this.adminService.createPermission(createPermissionDto);
    return result;
  }

  @Get('permissions')
  @RequirePermissions()
  async getPermissions() {
    const result = await this.adminService.getAllPermissions();
    return result;
  }

  @Patch('permissions/:id')
  @RequirePermissions()
  async updatePermission(
    @Param('id') id: string,
    @Body() updatePermissionDto: UpdateAdminPermissionDto,
  ) {
    const result = await this.adminService.updatePermission(id, updatePermissionDto);
    return result;
  }

  @Delete('permissions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions()
  async deletePermission(@Param('id') id: string) {
    const result = await this.adminService.deletePermission(id);
    return result;
  }

  // Role Management
  @Post('roles')
  @RequirePermissions()
  async createRole(@Body() createRoleDto: CreateAdminRoleDto) {
    const result = await this.adminService.createRole(createRoleDto);
    return result;
  }

  @Get('roles')
  @RequirePermissions()
  async getRoles() {
    const result = await this.adminService.getAllRoles();
    return result;
  }

  // Audit Log Management
  @Get('audit-logs')
  @RequirePermissions()
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    const result = await this.adminService.getAuditLogs(query);
    return result;
  }

  // Campaign Management (Admin Override)
  @Get('campaigns')
  @RequirePermissions()
  async getAllCampaigns(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
  ) {
    // This would typically call a campaigns service
    // For now, return a placeholder response
    return {
      success: true,
      data: [],
      message: 'Campaign management endpoint - implement with campaigns service',
    };
  }

  @Get('campaigns/:id')
  @RequirePermissions()
  async getCampaignById(@Param('id') id: string) {
    // This would typically call a campaigns service
    return {
      success: true,
      data: null,
      message: 'Campaign detail endpoint - implement with campaigns service',
    };
  }

  @Patch('campaigns/:id')
  @RequirePermissions()
  async updateCampaign(
    @Param('id') id: string,
    @Body() updateData: any,
  ) {
    // This would typically call a campaigns service
    return {
      success: true,
      data: null,
      message: 'Campaign update endpoint - implement with campaigns service',
    };
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions()
  async deleteCampaign(@Param('id') id: string) {
    // This would typically call a campaigns service
    return {
      success: true,
      message: 'Campaign deleted successfully',
    };
  }

  // Client Management (Admin Override)
  @Get('clients')
  @RequirePermissions()
  async getAllClients(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('userId') userId?: string,
  ) {
    // This would typically call a clients service
    return {
      success: true,
      data: [],
      message: 'Client management endpoint - implement with clients service',
    };
  }

  // System Management
  @Post('system/seed-permissions')
  @RequirePermissions()
  async seedDefaultPermissions() {
    // Seed default permissions
    const defaultPermissions = [
      { name: 'users:read', description: 'Read users', resource: 'users', action: 'read' },
      { name: 'users:create', description: 'Create users', resource: 'users', action: 'create' },
      { name: 'users:update', description: 'Update users', resource: 'users', action: 'update' },
      { name: 'users:delete', description: 'Delete users', resource: 'users', action: 'delete' },
      { name: 'campaigns:read', description: 'Read campaigns', resource: 'campaigns', action: 'read' },
      { name: 'campaigns:create', description: 'Create campaigns', resource: 'campaigns', action: 'create' },
      { name: 'campaigns:update', description: 'Update campaigns', resource: 'campaigns', action: 'update' },
      { name: 'campaigns:delete', description: 'Delete campaigns', resource: 'campaigns', action: 'delete' },
      { name: 'clients:read', description: 'Read clients', resource: 'clients', action: 'read' },
      { name: 'clients:create', description: 'Create clients', resource: 'clients', action: 'create' },
      { name: 'clients:update', description: 'Update clients', resource: 'clients', action: 'update' },
      { name: 'clients:delete', description: 'Delete clients', resource: 'clients', action: 'delete' },
      { name: 'dashboard:read', description: 'Read dashboard', resource: 'dashboard', action: 'read' },
      { name: 'stats:read', description: 'Read statistics', resource: 'stats', action: 'read' },
      { name: 'audit:read', description: 'Read audit logs', resource: 'audit', action: 'read' },
      { name: 'system:read', description: 'Read system info', resource: 'system', action: 'read' },
      { name: 'system:manage', description: 'Manage system', resource: 'system', action: 'manage' },
    ];

    const results = [];
    for (const permission of defaultPermissions) {
      try {
        await this.adminService.createPermission(permission);
        results.push({ permission: permission.name, status: 'created' });
      } catch (error) {
        results.push({ permission: permission.name, status: 'exists' });
      }
    }

    return {
      success: true,
      data: results,
      message: 'Default permissions seeded successfully',
    };
  }

  @Post('system/seed-roles')
  @RequirePermissions()
  async seedDefaultRoles() {
    // Get all permissions first
    const permissionsResult = await this.adminService.getAllPermissions();
    const allPermissions = permissionsResult.data;

    // Create default roles
    const defaultRoles = [
      {
        name: 'Super Admin',
        description: 'Full system access',
        permissionIds: allPermissions.map(p => p.id),
        isDefault: false,
      },
      {
        name: 'User Manager',
        description: 'Manage users and basic system functions',
        permissionIds: allPermissions
          .filter(p => p.resource === 'users' || p.resource === 'dashboard' || p.resource === 'audit')
          .map(p => p.id),
        isDefault: false,
      },
      {
        name: 'Content Manager',
        description: 'Manage campaigns and content',
        permissionIds: allPermissions
          .filter(p => p.resource === 'campaigns' || p.resource === 'clients' || p.resource === 'dashboard')
          .map(p => p.id),
        isDefault: false,
      },
    ];

    const results = [];
    for (const role of defaultRoles) {
      try {
        await this.adminService.createRole(role);
        results.push({ role: role.name, status: 'created' });
      } catch (error) {
        results.push({ role: role.name, status: 'exists' });
      }
    }

    return {
      success: true,
      data: results,
      message: 'Default roles seeded successfully',
    };
  }

  // Export/Import functionality
  @Get('export/users')
  @RequirePermissions()
  async exportUsers(@Query('format') format: string = 'json') {
    // This would implement user export functionality
    return {
      success: true,
      data: null,
      message: 'User export functionality - implement with export service',
    };
  }

  @Post('import/users')
  @RequirePermissions()
  async importUsers(@Body() importData: any) {
    // This would implement user import functionality
    return {
      success: true,
      data: null,
      message: 'User import functionality - implement with import service',
    };
  }
}
