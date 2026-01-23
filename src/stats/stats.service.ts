import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const userCount = await this.prisma.user.count({ where: { role: 'USER' } });
    const campaignCount = await this.prisma.campaign.count();
    const clientCount = await this.prisma.client.count();
    const activeCampaigns = await this.prisma.campaign.count({ 
      where: { status: 'active' } 
    });

    return {
      userCount,
      campaignCount,
      clientCount,
      activeCampaigns,
    };
  }

  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        campaigns: true,
        clients: true,
        aiContent: true,
        socialPosts: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId,
      totalCampaigns: user.campaigns.length,
      totalClients: user.clients.length,
      totalContent: user.aiContent.length,
      totalSocialPosts: user.socialPosts.length,
      activeCampaigns: user.campaigns.filter(c => c.status === 'active').length,
    };
  }

  async getSystemStats() {
    const [
      totalUsers,
      totalClients,
      totalCampaigns,
      totalContent,
      totalSocialPosts,
      totalChatbots,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.client.count(),
      this.prisma.campaign.count(),
      this.prisma.aIContent.count(),
      this.prisma.socialPost.count(),
      this.prisma.chatbot.count(),
      this.prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'paid' },
      }),
    ]);

    return {
      totalUsers,
      totalClients,
      totalCampaigns,
      totalContent,
      totalSocialPosts,
      totalChatbots,
      totalRevenue: totalRevenue._sum.amount || 0,
    };
  }
}
