import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { CreateAdminPermissionDto, UpdateAdminPermissionDto } from './dto/admin-permission.dto';
import { CreateAdminRoleDto, UpdateAdminRoleDto } from './dto/admin-permission.dto';
import { CreateAuditLogDto, AuditLogQueryDto } from './dto/admin-audit.dto';
import { AdminStatsQueryDto } from './dto/admin-stats.dto';
import { AdminUser, AdminDashboardStats, BulkOperationResult, SystemMetrics } from './types/admin.types';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // User Management
  async createAdminUser(createAdminUserDto: CreateAdminUserDto): Promise<AdminUser> {
    try {
      this.logger.log('Creating new admin user');

      const { permissions, ...userData } = createAdminUserDto;

      // Validate required fields
      if (!userData.email || !userData.password || !userData.name) {
        throw new BadRequestException('Email, password, and name are required');
      }

      // Check if email already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already in use');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      const user = await this.prisma.user.create({
        data: {
          email: userData.email,
          password: hashedPassword,
          name: userData.name,
          company: userData.company,
          phone: userData.phone,
          role: (userData.role as any) || 'USER',
          avatar: userData.avatar,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return user as AdminUser;
    } catch (error) {
      this.logger.error(`Failed to create admin user: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getAllUsers(options?: { page?: number; limit?: number; search?: string; role?: string }) {
    try {
      this.logger.log('Getting all users with admin privileges');

      const page = options?.page || 1;
      const limit = options?.limit || 30; // Increased from 10 to 30 to show all users
      const skip = (page - 1) * limit;

      const where: any = {};
      
      if (options?.search) {
        where.OR = [
          { name: { contains: options.search, mode: 'insensitive' } },
          { email: { contains: options.search, mode: 'insensitive' } },
          { company: { contains: options.search, mode: 'insensitive' } },
        ];
      }

      if (options?.role) {
        where.role = options.role;
      }

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          skip,
          take: limit,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            company: true,
            phone: true,
            avatar: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                campaigns: true,
                clients: true,
                aiContent: true,
                socialPosts: true,
                chatbots: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count({ where }),
      ]);

      return {
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get users: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getUserById(id: string): Promise<AdminUser> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              campaigns: true,
              clients: true,
              aiContent: true,
              socialPosts: true,
              chatbots: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return user as AdminUser;
    } catch (error) {
      this.logger.error(`Failed to get user: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getLastLoggedInUser(): Promise<AdminUser | null> {
    try {
      this.logger.log('Getting most recently logged in user');
      
      const user = await this.prisma.user.findFirst({
        where: {
          lastLoginAt: { not: null },
        },
        orderBy: {
          lastLoginAt: 'desc',
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return user as AdminUser | null;
    } catch (error) {
      this.logger.error(`Failed to get last logged in user: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async updateUser(id: string, updateUserDto: UpdateAdminUserDto): Promise<AdminUser> {
    try {
      this.logger.log(`Updating user ${id}`);

      const existingUser = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      let updateData: any = { ...updateUserDto };

      // Hash password if it's being updated
      if (updateUserDto.password) {
        updateData.password = await bcrypt.hash(updateUserDto.password, 10);
      }

      const user = await this.prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return user as AdminUser;
    } catch (error) {
      this.logger.error(`Failed to update user: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async deleteUser(id: string): Promise<void> {
    try {
      this.logger.log(`Deleting user ${id}`);

      const existingUser = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // Prevent deletion of the last admin
      if (existingUser.role === 'ADMIN') {
        const adminCount = await this.prisma.user.count({
          where: { role: 'ADMIN', isActive: true },
        });

        if (adminCount <= 1) {
          throw new BadRequestException('Cannot delete the last admin user');
        }
      }

      // Soft delete by setting isActive to false
      await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      this.logger.error(`Failed to delete user: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async bulkUpdateUsers(ids: string[], updateData: Partial<UpdateAdminUserDto>): Promise<BulkOperationResult> {
    try {
      this.logger.log(`Bulk updating users: ${ids.join(', ')}`);

      const results: BulkOperationResult = {
        success: 0,
        failed: 0,
        errors: [],
        affectedIds: [],
      };

      for (const id of ids) {
        try {
          await this.updateUser(id, updateData);
          results.success++;
          results.affectedIds.push(id);
        } catch (error) {
          results.failed++;
          results.errors.push(`User ${id}: ${this.getErrorMessage(error)}`);
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`Failed to bulk update users: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  // Permission Management
  async createPermission(createPermissionDto: CreateAdminPermissionDto) {
    try {
      this.logger.log('Creating new permission');

      const permission = await this.prisma.adminPermission.create({
        data: createPermissionDto,
      });

      return {
        success: true,
        data: permission,
      };
    } catch (error) {
      this.logger.error(`Failed to create permission: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getAllPermissions() {
    try {
      const permissions = await this.prisma.adminPermission.findMany({
        orderBy: { name: 'asc' },
      });

      return {
        success: true,
        data: permissions,
      };
    } catch (error) {
      this.logger.error(`Failed to get permissions: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async updatePermission(id: string, updatePermissionDto: UpdateAdminPermissionDto) {
    try {
      this.logger.log(`Updating permission ${id}`);

      const permission = await this.prisma.adminPermission.update({
        where: { id },
        data: updatePermissionDto,
      });

      return {
        success: true,
        data: permission,
      };
    } catch (error) {
      this.logger.error(`Failed to update permission: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async deletePermission(id: string) {
    try {
      this.logger.log(`Deleting permission ${id}`);

      await this.prisma.adminPermission.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Permission deleted successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to delete permission: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  // Role Management
  async createRole(createRoleDto: CreateAdminRoleDto) {
    try {
      this.logger.log('Creating new role');

      const { permissionIds, ...roleData } = createRoleDto;

      const role = await this.prisma.adminRole.create({
        data: {
          ...roleData,
          permissions: {
            connect: permissionIds.map(id => ({ id })),
          },
        },
        include: {
          permissions: true,
        },
      });

      return {
        success: true,
        data: role,
      };
    } catch (error) {
      this.logger.error(`Failed to create role: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getAllRoles() {
    try {
      const roles = await this.prisma.adminRole.findMany({
        include: {
          permissions: true,
        },
        orderBy: { name: 'asc' },
      });

      return {
        success: true,
        data: roles,
      };
    } catch (error) {
      this.logger.error(`Failed to get roles: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  // Audit Log Management
  async createAuditLog(createAuditLogDto: CreateAuditLogDto) {
    try {
      const auditLog = await this.prisma.adminAuditLog.create({
        data: createAuditLogDto,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return auditLog;
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getAuditLogs(query: AuditLogQueryDto) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 50;
      const skip = (page - 1) * limit;

      const where: any = {};

      if (query.adminId) {
        where.adminId = query.adminId;
      }

      if (query.action) {
        where.action = query.action;
      }

      if (query.resource) {
        where.resource = query.resource;
      }

      if (query.resourceId) {
        where.resourceId = query.resourceId;
      }

      if (query.startDate || query.endDate) {
        where.createdAt = {};
        if (query.startDate) {
          where.createdAt.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          where.createdAt.lte = new Date(query.endDate);
        }
      }

      const [auditLogs, total] = await Promise.all([
        this.prisma.adminAuditLog.findMany({
          where,
          skip,
          take: limit,
          include: {
            admin: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.adminAuditLog.count({ where }),
      ]);

      return {
        success: true,
        data: auditLogs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get audit logs: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  // Dashboard and Statistics
  async getDashboardStats(): Promise<AdminDashboardStats> {
    try {
      this.logger.log('Getting dashboard statistics');

      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());

      const [
        totalUsers,
        activeUsers,
        totalCampaigns,
        activeCampaigns,
        totalClients,
        lastMonthUsers,
        lastMonthCampaigns,
        recentActivity,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.campaign.count(),
        this.prisma.campaign.count({ where: { status: 'active' } }),
        this.prisma.client.count(),
        this.prisma.user.count({
          where: {
            createdAt: { gte: lastMonth },
          },
        }),
        this.prisma.campaign.count({
          where: {
            createdAt: { gte: lastMonth },
          },
        }),
        this.prisma.adminAuditLog.findMany({
          take: 10,
          include: {
            admin: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      // Calculate growth rates
      const previousMonthUsers = await this.prisma.user.count({
        where: {
          createdAt: {
            gte: twoMonthsAgo,
            lt: lastMonth,
          },
        },
      });

      const previousMonthCampaigns = await this.prisma.campaign.count({
        where: {
          createdAt: {
            gte: twoMonthsAgo,
            lt: lastMonth,
          },
        },
      });

      const userGrowthRate = previousMonthUsers > 0 
        ? ((lastMonthUsers - previousMonthUsers) / previousMonthUsers) * 100 
        : 0;

      const campaignGrowthRate = previousMonthCampaigns > 0 
        ? ((lastMonthCampaigns - previousMonthCampaigns) / previousMonthCampaigns) * 100 
        : 0;

      return {
        totalUsers,
        activeUsers,
        totalCampaigns,
        activeCampaigns,
        totalClients,
        totalRevenue: 0, // TODO: Implement revenue calculation
        monthlyGrowth: {
          users: userGrowthRate,
          campaigns: campaignGrowthRate,
          revenue: 0, // TODO: Implement revenue growth
        },
        recentActivity: recentActivity as any,
        systemHealth: {
          status: 'healthy',
          uptime: process.uptime(),
          responseTime: 0, // TODO: Implement response time monitoring
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get dashboard stats: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());

      const [
        totalUsers,
        activeUsers,
        newThisMonth,
        totalCampaigns,
        activeCampaigns,
        completedCampaigns,
        lastMonthUsers,
        lastMonthCampaigns,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.user.count({
          where: {
            createdAt: { gte: lastMonth },
          },
        }),
        this.prisma.campaign.count(),
        this.prisma.campaign.count({ where: { status: 'active' } }),
        this.prisma.campaign.count({ where: { status: 'completed' } }),
        this.prisma.user.count({
          where: {
            createdAt: {
              gte: twoMonthsAgo,
              lt: lastMonth,
            },
          },
        }),
        this.prisma.campaign.count({
          where: {
            createdAt: {
              gte: twoMonthsAgo,
              lt: lastMonth,
            },
          },
        }),
      ]);

      const userGrowthRate = lastMonthUsers > 0 
        ? ((newThisMonth - lastMonthUsers) / lastMonthUsers) * 100 
        : 0;

      const campaignGrowthRate = lastMonthCampaigns > 0 
        ? ((lastMonthCampaigns - lastMonthCampaigns) / lastMonthCampaigns) * 100 
        : 0;

      const successRate = totalCampaigns > 0 
        ? (completedCampaigns / totalCampaigns) * 100 
        : 0;

      return {
        users: {
          total: totalUsers,
          active: activeUsers,
          newThisMonth,
          growthRate: userGrowthRate,
        },
        campaigns: {
          total: totalCampaigns,
          active: activeCampaigns,
          completed: completedCampaigns,
          successRate,
        },
        revenue: {
          total: 0, // TODO: Implement revenue calculation
          monthly: 0,
          growthRate: 0,
        },
        system: {
          uptime: process.uptime(),
          responseTime: 0, // TODO: Implement response time monitoring
          errorRate: 0, // TODO: Implement error rate monitoring
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get system metrics: ${this.getErrorMessage(error)}`);
      throw error;
    }
  }

  // Helper method for permissions guard
  async getUserPermissions(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          // This would need to be implemented based on your permission system
          // For now, return empty array as admin users have all permissions
        },
      });

      if (!user || user.role !== 'ADMIN') {
        return [];
      }

      // Admin users have all permissions
      return await this.prisma.adminPermission.findMany();
    } catch (error) {
      this.logger.error(`Failed to get user permissions: ${this.getErrorMessage(error)}`);
      return [];
    }
  }

  // System Health Check
  async getSystemHealth() {
    try {
      const startTime = Date.now();
      
      // Test database connection
      await this.prisma.user.count();
      const dbResponseTime = Date.now() - startTime;

      const health = {
        database: {
          status: dbResponseTime < 1000 ? 'healthy' : 'degraded',
          responseTime: dbResponseTime,
          connections: 1, // TODO: Get actual connection count
        },
        services: {
          database: {
            status: dbResponseTime < 1000 ? 'healthy' : 'degraded',
            responseTime: dbResponseTime,
            lastCheck: new Date(),
          },
        },
        system: {
          cpu: process.cpuUsage().system,
          memory: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
          disk: 0, // TODO: Implement disk usage check
          uptime: process.uptime(),
        },
      };

      return health;
    } catch (error) {
      this.logger.error(`Failed to get system health: ${this.getErrorMessage(error)}`);
      return {
        database: {
          status: 'down',
          responseTime: 0,
          connections: 0,
        },
        services: {
          database: {
            status: 'down',
            responseTime: 0,
            lastCheck: new Date(),
          },
        },
        system: {
          cpu: 0,
          memory: 0,
          disk: 0,
          uptime: process.uptime(),
        },
      };
    }
  }
}