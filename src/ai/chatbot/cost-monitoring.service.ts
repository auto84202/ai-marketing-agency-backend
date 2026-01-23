import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CostMonitoringService {
  private readonly logger = new Logger(CostMonitoringService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Get cost summary for a user
   */
  async getUserCostSummary(userId: string, period: 'day' | 'week' | 'month' = 'month') {
    try {
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      const usage = await this.prisma.aPIUsage.aggregate({
        where: {
          userId,
          requestTime: { gte: startDate },
          service: 'chatbot',
        },
        _sum: {
          cost: true,
          tokensUsed: true,
        },
        _count: {
          id: true,
        },
      });

      const config = this.getCostConfig();
      const totalCost = usage._sum.cost || 0;
      const totalTokens = usage._sum.tokensUsed || 0;
      const totalRequests = usage._count.id || 0;

      return {
        period,
        totalCost,
        totalTokens,
        totalRequests,
        averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
        averageTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
        limits: {
          daily: config.limitPerDay,
          monthly: config.limitPerUserMonthly,
        },
        usage: {
          dailyPercentage: (totalCost / config.limitPerDay) * 100,
          monthlyPercentage: (totalCost / config.limitPerUserMonthly) * 100,
        },
        isOverLimit: {
          daily: totalCost > config.limitPerDay,
          monthly: totalCost > config.limitPerUserMonthly,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get user cost summary: ${error}`);
      throw error;
    }
  }

  /**
   * Get cost summary for all users (admin)
   */
  async getAllUsersCostSummary(period: 'day' | 'week' | 'month' = 'month') {
    try {
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      const usage = await this.prisma.aPIUsage.aggregate({
        where: {
          requestTime: { gte: startDate },
          service: 'chatbot',
        },
        _sum: {
          cost: true,
          tokensUsed: true,
        },
        _count: {
          id: true,
        },
      });

      const totalCost = usage._sum.cost || 0;
      const totalTokens = usage._sum.tokensUsed || 0;
      const totalRequests = usage._count.id || 0;

      // Get unique users count
      const uniqueUsers = await this.prisma.aPIUsage.findMany({
        where: {
          requestTime: { gte: startDate },
          service: 'chatbot',
        },
        select: {
          userId: true,
        },
        distinct: ['userId'],
      });

      return {
        period,
        totalCost,
        totalTokens,
        totalRequests,
        uniqueUsers: uniqueUsers.length,
        averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
        averageTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
        averageCostPerUser: uniqueUsers.length > 0 ? totalCost / uniqueUsers.length : 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get all users cost summary: ${error}`);
      throw error;
    }
  }

  /**
   * Get top users by cost
   */
  async getTopUsersByCost(limit: number = 10, period: 'day' | 'week' | 'month' = 'month') {
    try {
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      const topUsers = await this.prisma.aPIUsage.groupBy({
        by: ['userId'],
        where: {
          requestTime: { gte: startDate },
          service: 'chatbot',
        },
        _sum: {
          cost: true,
          tokensUsed: true,
        },
        _count: {
          id: true,
        },
        orderBy: {
          _sum: {
            cost: 'desc',
          },
        },
        take: limit,
      });

      // Get user details
      const userIds = topUsers.map(user => user.userId);
      const users = await this.prisma.user.findMany({
        where: {
          id: { in: userIds },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      const userMap = new Map(users.map(user => [user.id, user]));

      return topUsers.map(user => ({
        user: userMap.get(user.userId) || { id: user.userId, name: 'Unknown', email: 'Unknown' },
        totalCost: user._sum.cost || 0,
        totalTokens: user._sum.tokensUsed || 0,
        totalRequests: user._count.id || 0,
      }));
    } catch (error) {
      this.logger.error(`Failed to get top users by cost: ${error}`);
      throw error;
    }
  }

  /**
   * Check for users approaching cost limits
   */
  async checkUsersApproachingLimits() {
    try {
      const config = this.getCostConfig();
      const alertThreshold = config.alertThresholdPercentage / 100;
      
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Check daily limits
      const dailyUsage = await this.prisma.aPIUsage.groupBy({
        by: ['userId'],
        where: {
          requestTime: { gte: startOfDay },
          service: 'chatbot',
        },
        _sum: {
          cost: true,
        },
      });

      // Check monthly limits
      const monthlyUsage = await this.prisma.aPIUsage.groupBy({
        by: ['userId'],
        where: {
          requestTime: { gte: startOfMonth },
          service: 'chatbot',
        },
        _sum: {
          cost: true,
        },
      });

      // Filter users who exceed the alert threshold
      const dailyAlerts = dailyUsage
        .filter(user => (user._sum.cost || 0) >= config.limitPerDay * alertThreshold)
        .map(user => ({
          userId: user.userId,
          cost: user._sum.cost || 0,
          limit: config.limitPerDay,
          percentage: ((user._sum.cost || 0) / config.limitPerDay) * 100,
        }));

      const monthlyAlerts = monthlyUsage
        .filter(user => (user._sum.cost || 0) >= config.limitPerUserMonthly * alertThreshold)
        .map(user => ({
          userId: user.userId,
          cost: user._sum.cost || 0,
          limit: config.limitPerUserMonthly,
          percentage: ((user._sum.cost || 0) / config.limitPerUserMonthly) * 100,
        }));

      return {
        dailyAlerts,
        monthlyAlerts,
      };
    } catch (error) {
      this.logger.error(`Failed to check users approaching limits: ${error}`);
      throw error;
    }
  }

  /**
   * Daily cost monitoring cron job
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async dailyCostMonitoring() {
    try {
      this.logger.log('Running daily cost monitoring...');
      
      const alerts = await this.checkUsersApproachingLimits();
      
      if (alerts.dailyAlerts.length > 0 || alerts.monthlyAlerts.length > 0) {
        this.logger.warn(`Cost limit alerts: ${alerts.dailyAlerts.length} daily, ${alerts.monthlyAlerts.length} monthly`);
        
        // Here you could send notifications, emails, etc.
        // For now, just log the alerts
        alerts.dailyAlerts.forEach((alert: any) => {
          this.logger.warn(`User ${alert.userId} approaching daily limit: ${alert.percentage.toFixed(1)}%`);
        });
        
        alerts.monthlyAlerts.forEach((alert: any) => {
          this.logger.warn(`User ${alert.userId} approaching monthly limit: ${alert.percentage.toFixed(1)}%`);
        });
      }
      
      this.logger.log('Daily cost monitoring completed');
    } catch (error) {
      this.logger.error(`Daily cost monitoring failed: ${error}`);
    }
  }

  /**
   * Get cost configuration
   */
  private getCostConfig() {
    return {
      limitPerUserMonthly: this.configService.get('chatbot.costManagement.limitPerUserMonthly', 50.00),
      limitPerDay: this.configService.get('chatbot.costManagement.limitPerDay', 100.00),
      alertThresholdPercentage: this.configService.get('chatbot.costManagement.alertThresholdPercentage', 80),
    };
  }
}
