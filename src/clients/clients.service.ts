import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { CreateLeadDto } from './dto/create-lead.dto';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a lead from contact form (no user ID required)
   */
  async createLead(createLeadDto: CreateLeadDto) {
    try {
      this.logger.log(`Creating lead from contact form`);
      this.logger.log(`Lead data:`, createLeadDto);

      // Create a client without userId (will be assigned later when user signs up)
      // For now, create with a system user or leave it as a lead
      const client = await this.prisma.client.create({
        data: {
          name: createLeadDto.name,
          email: createLeadDto.email,
          company: createLeadDto.company,
          phone: createLeadDto.phone,
          industry: createLeadDto.industry,
          notes: createLeadDto.message,
          budget: this.parseBudgetValue(createLeadDto.budget),
          userId: 'system', // Placeholder - will be updated when assigned to a user
          isActive: true,
        },
      });

      return {
        success: true,
        message: 'Thank you! Your message has been received. We will contact you within 24 hours.',
        data: {
          id: client.id,
          name: client.name,
          email: client.email,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create lead: ${msg}`);
      
      // Return success anyway to not expose internal errors to public
      return {
        success: true,
        message: 'Thank you! Your message has been received.',
      };
    }
  }

  /**
   * Parse budget value from string to number
   */
  private parseBudgetValue(budget?: string): number | undefined {
    if (!budget) return undefined;
    
    const budgetMap: Record<string, number> = {
      'under-5k': 5000,
      '5k-10k': 10000,
      '10k-25k': 25000,
      '25k-50k': 50000,
      '50k-100k': 100000,
      'over-100k': 150000,
    };
    
    return budgetMap[budget] || undefined;
  }

  /**
   * Create a new client
   */
  async create(userId: string, createClientDto: CreateClientDto) {
    try {
      this.logger.log(`Creating client for user ${userId}`);
      this.logger.log(`Client data:`, createClientDto);

      const client = await this.prisma.client.create({
        data: {
          userId,
          ...createClientDto,
        },
        include: {
          campaigns: true,
          reports: true,
          chatbots: true,
        },
      });

      return {
        success: true,
        data: client,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create client: ${msg}`);
      throw error;
    }
  }

  /**
   * Get all clients for a user
   */
  async findAll(userId: string, options?: { page?: number; limit?: number }, isAdmin: boolean = false) {
    try {
      this.logger.log(`Getting clients for user ${userId} (admin: ${isAdmin})`);

      const page = options?.page || 1;
      const limit = options?.limit || 10;
      const skip = (page - 1) * limit;

      // Admin users can see all clients, regular users see only their own
      const whereClause = isAdmin ? {} : { userId };

      const [clients, total] = await Promise.all([
        this.prisma.client.findMany({
          where: whereClause,
          skip,
          take: limit,
          include: {
            user: isAdmin ? {
              select: {
                id: true,
                name: true,
                email: true,
                company: true
              }
            } : false,
            campaigns: {
              select: {
                id: true,
                name: true,
                type: true,
                status: true,
                createdAt: true,
              },
            },
            _count: {
              select: {
                campaigns: true,
                reports: true,
                chatbots: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.client.count({ where: whereClause }),
      ]);

      return {
        success: true,
        data: clients,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get clients: ${msg}`);
      throw error;
    }
  }

  /**
   * Get a specific client
   */
  async findOne(userId: string, clientId: string) {
    try {
      this.logger.log(`Getting client ${clientId} for user ${userId}`);

      const client = await this.prisma.client.findFirst({
        where: {
          id: clientId,
          userId,
        },
        include: {
          campaigns: {
            include: {
              aiContent: {
                select: {
                  id: true,
                  type: true,
                  title: true,
                  createdAt: true,
                },
              },
              socialPosts: {
                select: {
                  id: true,
                  platform: true,
                  content: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
          },
          reports: {
            select: {
              id: true,
              periodStart: true,
              periodEnd: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          chatbots: {
            select: {
              id: true,
              name: true,
              status: true,
              platform: true,
              createdAt: true,
            },
          },
        },
      });

      if (!client) {
        throw new NotFoundException('Client not found');
      }

      return {
        success: true,
        data: client,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get client: ${msg}`);
      throw error;
    }
  }

  /**
   * Update a client
   */
  async update(userId: string, clientId: string, updateClientDto: UpdateClientDto) {
    try {
      this.logger.log(`Updating client ${clientId} for user ${userId}`);

      // Check if client exists and belongs to user
      const existingClient = await this.prisma.client.findFirst({
        where: {
          id: clientId,
          userId,
        },
      });

      if (!existingClient) {
        throw new NotFoundException('Client not found');
      }

      const client = await this.prisma.client.update({
        where: { id: clientId },
        data: updateClientDto,
        include: {
          campaigns: true,
          reports: true,
          chatbots: true,
        },
      });

      return {
        success: true,
        data: client,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update client: ${msg}`);
      throw error;
    }
  }

  /**
   * Delete a client
   */
  async remove(userId: string, clientId: string) {
    try {
      this.logger.log(`Deleting client ${clientId} for user ${userId}`);

      // Check if client exists and belongs to user
      const existingClient = await this.prisma.client.findFirst({
        where: {
          id: clientId,
          userId,
        },
      });

      if (!existingClient) {
        throw new NotFoundException('Client not found');
      }

      // Soft delete by setting isActive to false
      await this.prisma.client.update({
        where: { id: clientId },
        data: { isActive: false },
      });

      return {
        success: true,
        message: 'Client deleted successfully',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete client: ${msg}`);
      throw error;
    }
  }

  /**
   * Get client analytics
   */
  async getAnalytics(userId: string, clientId: string) {
    try {
      this.logger.log(`Getting analytics for client ${clientId}`);

      // Check if client exists and belongs to user
      const client = await this.prisma.client.findFirst({
        where: {
          id: clientId,
          userId,
        },
        include: {
          campaigns: {
            include: {
              aiContent: true,
              socialPosts: true,
            },
          },
          reports: true,
          chatbots: true,
        },
      });

      if (!client) {
        throw new NotFoundException('Client not found');
      }

      const analytics = {
        totalCampaigns: client.campaigns.length,
        activeCampaigns: client.campaigns.filter(c => c.status === 'active').length,
        totalContent: client.campaigns.reduce((sum, c) => sum + c.aiContent.length, 0),
        totalSocialPosts: client.campaigns.reduce((sum, c) => sum + c.socialPosts.length, 0),
        totalReports: client.reports.length,
        totalChatbots: client.chatbots.length,
        activeChatbots: client.chatbots.filter(c => c.status === 'ACTIVE').length,
        monthlyGrowth: this.calculateMonthlyGrowth(client.campaigns),
        lastActivity: this.getLastActivity(client),
      };

      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get client analytics: ${msg}`);
      throw error;
    }
  }

  /**
   * Get client dashboard data
   */
  async getDashboard(userId: string, clientId: string) {
    try {
      this.logger.log(`Getting dashboard for client ${clientId}`);

      const client = await this.findOne(userId, clientId);
      
      if (!client.success) {
        throw new NotFoundException('Client not found');
      }

      const dashboard = {
        client: client.data,
        recentActivity: await this.getRecentActivity(clientId),
        performanceMetrics: await this.getPerformanceMetrics(clientId),
        upcomingTasks: await this.getUpcomingTasks(clientId),
      };

      return {
        success: true,
        data: dashboard,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get client dashboard: ${msg}`);
      throw error;
    }
  }

  /**
   * Calculate monthly growth
   */
  private calculateMonthlyGrowth(campaigns: any[]): number {
    const now = new Date();
    const currentMonth = campaigns.filter(c => {
      const createdAt = new Date(c.createdAt);
      return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();
    }).length;

    const lastMonth = campaigns.filter(c => {
      const createdAt = new Date(c.createdAt);
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1);
      return createdAt.getMonth() === lastMonthDate.getMonth() && createdAt.getFullYear() === lastMonthDate.getFullYear();
    }).length;

    if (lastMonth === 0) return currentMonth > 0 ? 100 : 0;
    return ((currentMonth - lastMonth) / lastMonth) * 100;
  }

  /**
   * Get last activity
   */
  private getLastActivity(client: any): Date | null {
    const activities = [
      ...client.campaigns.map((c: any) => c.createdAt),
      ...client.reports.map((r: any) => r.createdAt),
      ...client.chatbots.map((c: any) => c.createdAt),
    ];

    if (activities.length === 0) return null;
    return new Date(Math.max(...activities.map(a => new Date(a).getTime())));
  }

  /**
   * Get recent activity
   */
  private async getRecentActivity(clientId: string): Promise<any[]> {
    const activities = [];

    // Get recent campaigns
    const recentCampaigns = await this.prisma.campaign.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        createdAt: true,
      },
    });

    activities.push(...recentCampaigns.map(c => ({
      type: 'campaign',
      action: 'created',
      data: c,
      timestamp: c.createdAt,
    })));

    // Get recent reports
    const recentReports = await this.prisma.report.findMany({
      where: { userId: clientId }, // Note: This might need adjustment based on your schema
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
      },
    });

    activities.push(...recentReports.map(r => ({
      type: 'report',
      action: 'generated',
      data: r,
      timestamp: r.createdAt,
    })));

    return activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(clientId: string): Promise<any> {
    // TODO: Implement real performance metrics calculation
    return {
      totalImpressions: Math.floor(Math.random() * 100000) + 10000,
      totalClicks: Math.floor(Math.random() * 5000) + 500,
      totalConversions: Math.floor(Math.random() * 200) + 20,
      averageCTR: Math.random() * 5 + 1,
      averageConversionRate: Math.random() * 10 + 2,
    };
  }

  /**
   * Get upcoming tasks
   */
  private async getUpcomingTasks(clientId: string): Promise<any[]> {
    // TODO: Implement real task management
    return [
      {
        id: 'task_1',
        title: 'Review campaign performance',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'high',
        type: 'review',
      },
      {
        id: 'task_2',
        title: 'Generate monthly report',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        priority: 'medium',
        type: 'report',
      },
    ];
  }
}
