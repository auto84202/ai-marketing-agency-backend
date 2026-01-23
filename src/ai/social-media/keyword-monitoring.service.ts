import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FacebookService } from '../../integrations/social/facebook.service';
import { InstagramService } from '../../integrations/social/instagram.service';
import { TwitterService } from '../../integrations/social/twitter.service';
import { LinkedInService } from '../../integrations/social/linkedin.service';

export interface KeywordCampaign {
  id: string;
  userId: string;
  businessName: string;
  businessDescription: string;
  keywords: string[];
  platforms: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface KeywordMatch {
  id: string;
  campaignId: string;
  platform: string;
  postId: string;
  commentId?: string;
  content: string;
  author: string;
  authorId: string;
  authorProfileUrl?: string;
  postUrl: string;
  matchedKeywords: string[];
  timestamp: Date;
  engagementStatus: 'PENDING' | 'ENGAGED' | 'SKIPPED' | 'FAILED';
  sentimentScore?: number;
}

export interface PlatformStatistics {
  platform: string;
  totalMatches: number;
  last1Hour: number;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
  engagedCount: number;
  pendingCount: number;
  topKeywords: { keyword: string; count: number }[];
}

export interface CampaignStatistics {
  campaignId: string;
  totalMatches: number;
  platformStats: PlatformStatistics[];
  recentMatches: KeywordMatch[];
  engagementRate: number;
  averageSentiment: number;
  lastScannedAt: Date;
}

@Injectable()
export class KeywordMonitoringService {
  private readonly logger = new Logger(KeywordMonitoringService.name);
  private activeCampaigns: Map<string, KeywordCampaign> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly facebookService: FacebookService,
    private readonly instagramService: InstagramService,
    private readonly twitterService: TwitterService,
    private readonly linkedinService: LinkedInService,
  ) {}

  /**
   * Create a new keyword monitoring campaign
   */
  async createCampaign(
    userId: string,
    businessName: string,
    businessDescription: string,
    keywords: string[],
    platforms: string[] = ['FACEBOOK', 'INSTAGRAM', 'TWITTER', 'LINKEDIN', 'REDDIT'],
  ): Promise<KeywordCampaign> {
    try {
      this.logger.log(`Creating keyword campaign for user: ${userId}, business: ${businessName}`);

      const campaign = await this.prisma.keywordCampaign.create({
        data: {
          userId,
          businessName,
          businessDescription,
          keywords,
          platforms,
          isActive: true,
        },
      });

      this.activeCampaigns.set(campaign.id, campaign as any);

      // Start immediate scan
      this.scanCampaignKeywords(campaign.id).catch((error) => {
        this.logger.error(`Failed to scan campaign ${campaign.id}: ${error.message}`);
      });

      return campaign as any;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create campaign: ${msg}`);
      throw error;
    }
  }

  /**
   * Get all campaigns for a user
   */
  async getUserCampaigns(userId: string): Promise<KeywordCampaign[]> {
    const campaigns = await this.prisma.keywordCampaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return campaigns as any;
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStatistics(campaignId: string): Promise<CampaignStatistics> {
    try {
      const campaign = await this.prisma.keywordCampaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get all matches for this campaign
      const allMatches = await this.prisma.keywordMatch.findMany({
        where: { campaignId },
        orderBy: { timestamp: 'desc' },
      });

      const totalMatches = allMatches.length;

      // Calculate platform statistics
      const platformStats: PlatformStatistics[] = [];
      const platforms = campaign.platforms as string[];

      for (const platform of platforms) {
        const platformMatches = allMatches.filter((m) => m.platform === platform);
        
        const stats: PlatformStatistics = {
          platform,
          totalMatches: platformMatches.length,
          last1Hour: platformMatches.filter((m) => m.timestamp >= oneHourAgo).length,
          last24Hours: platformMatches.filter((m) => m.timestamp >= oneDayAgo).length,
          last7Days: platformMatches.filter((m) => m.timestamp >= sevenDaysAgo).length,
          last30Days: platformMatches.filter((m) => m.timestamp >= thirtyDaysAgo).length,
          engagedCount: platformMatches.filter((m) => m.engagementStatus === 'ENGAGED').length,
          pendingCount: platformMatches.filter((m) => m.engagementStatus === 'PENDING').length,
          topKeywords: this.calculateTopKeywords(platformMatches),
        };

        platformStats.push(stats);
      }

      // Get recent matches (last 50)
      const recentMatches = allMatches.slice(0, 50) as any[];

      // Calculate engagement metrics
      const engagedCount = allMatches.filter((m) => m.engagementStatus === 'ENGAGED').length;
      const engagementRate = totalMatches > 0 ? (engagedCount / totalMatches) * 100 : 0;

      // Calculate average sentiment
      const matchesWithSentiment = allMatches.filter((m) => m.sentimentScore !== null);
      const averageSentiment =
        matchesWithSentiment.length > 0
          ? matchesWithSentiment.reduce((sum, m) => sum + (m.sentimentScore || 0), 0) /
            matchesWithSentiment.length
          : 0;

      return {
        campaignId,
        totalMatches,
        platformStats,
        recentMatches,
        engagementRate,
        averageSentiment,
        lastScannedAt: campaign.lastScannedAt || campaign.createdAt,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get campaign statistics: ${msg}`);
      throw error;
    }
  }

  /**
   * Scan all active campaigns (runs periodically)
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async scanAllCampaigns(): Promise<void> {
    try {
      this.logger.log('Starting periodic scan of all active campaigns');

      const campaigns = await this.prisma.keywordCampaign.findMany({
        where: { isActive: true },
      });

      for (const campaign of campaigns) {
        await this.scanCampaignKeywords(campaign.id).catch((error) => {
          this.logger.error(`Failed to scan campaign ${campaign.id}: ${error.message}`);
        });
      }

      this.logger.log(`Completed scanning ${campaigns.length} campaigns`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to scan campaigns: ${msg}`);
    }
  }

  /**
   * Scan specific campaign keywords across all platforms
   */
  async scanCampaignKeywords(campaignId: string): Promise<KeywordMatch[]> {
    try {
      const campaign = await this.prisma.keywordCampaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || !campaign.isActive) {
        return [];
      }

      this.logger.log(`Scanning campaign ${campaignId} with keywords: ${campaign.keywords}`);

      const allMatches: KeywordMatch[] = [];
      const platforms = campaign.platforms as string[];

      // Scan each platform in parallel
      const scanPromises = platforms.map((platform) =>
        this.scanPlatform(campaignId, platform, campaign.keywords as string[], campaign.userId)
          .catch((error) => {
            this.logger.error(`Error scanning ${platform} for campaign ${campaignId}: ${error.message}`);
            return [];
          }),
      );

      const platformMatches = await Promise.all(scanPromises);
      platformMatches.forEach((matches) => allMatches.push(...matches));

      // Update last scanned timestamp
      await this.prisma.keywordCampaign.update({
        where: { id: campaignId },
        data: { lastScannedAt: new Date() },
      });

      this.logger.log(`Found ${allMatches.length} new matches for campaign ${campaignId}`);

      return allMatches;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to scan campaign keywords: ${msg}`);
      throw error;
    }
  }

  /**
   * Scan a specific platform for keywords
   */
  private async scanPlatform(
    campaignId: string,
    platform: string,
    keywords: string[],
    userId: string,
  ): Promise<KeywordMatch[]> {
    try {
      this.logger.log(`Scanning ${platform} for keywords: ${keywords.join(', ')}`);

      // Get user's social media tokens
      const socialAccount = await this.prisma.socialAccount.findFirst({
        where: {
          userId,
          platform,
          isActive: true,
        },
      });

      if (!socialAccount) {
        this.logger.warn(`No active ${platform} account found for user ${userId}`);
        return [];
      }

      const matches: KeywordMatch[] = [];

      // Scan for each keyword
      for (const keyword of keywords) {
        let platformMatches: any[] = [];

        switch (platform) {
          case 'FACEBOOK':
            platformMatches = await this.scanFacebook(socialAccount.accessToken, keyword);
            break;
          case 'INSTAGRAM':
            platformMatches = await this.scanInstagram(
              socialAccount.accessToken,
              keyword,
              socialAccount.accountId,
            );
            break;
          case 'TWITTER':
            platformMatches = await this.scanTwitter(socialAccount.accessToken, keyword);
            break;
          case 'LINKEDIN':
            platformMatches = await this.scanLinkedIn(socialAccount.accessToken, keyword);
            break;
          case 'REDDIT':
            platformMatches = await this.scanReddit(keyword);
            break;
          default:
            this.logger.warn(`Unsupported platform: ${platform}`);
        }

        // Save matches to database
        for (const match of platformMatches) {
          // Check if match already exists
          const existing = await this.prisma.keywordMatch.findFirst({
            where: {
              campaignId,
              platform,
              postId: match.postId,
              commentId: match.commentId || null,
            },
          });

          if (!existing) {
            const savedMatch = await this.prisma.keywordMatch.create({
              data: {
                campaignId,
                platform,
                postId: match.postId,
                commentId: match.commentId,
                content: match.content,
                author: match.author,
                authorId: match.authorId,
                authorProfileUrl: match.authorProfileUrl,
                postUrl: match.postUrl,
                matchedKeywords: [keyword],
                timestamp: match.timestamp || new Date(),
                engagementStatus: 'PENDING',
                sentimentScore: match.sentimentScore,
              },
            });

            matches.push(savedMatch as any);
          }
        }
      }

      return matches;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to scan ${platform}: ${msg}`);
      throw error;
    }
  }

  /**
   * Scan Facebook for keyword mentions
   */
  private async scanFacebook(accessToken: string, keyword: string): Promise<any[]> {
    try {
      // Search for posts/comments containing keyword
      const results = await this.facebookService.searchPosts(accessToken, keyword, {
        maxResults: 50,
      });

      return results.map((post: any) => ({
        postId: post.id,
        content: post.message || post.story || '',
        author: post.from?.name || 'Unknown',
        authorId: post.from?.id || '',
        authorProfileUrl: `https://facebook.com/${post.from?.id}`,
        postUrl: post.permalink_url || `https://facebook.com/${post.id}`,
        timestamp: new Date(post.created_time),
      }));
    } catch (error) {
      this.logger.error(`Facebook scan error: ${error}`);
      return [];
    }
  }

  /**
   * Scan Instagram for keyword mentions
   */
  private async scanInstagram(accessToken: string, keyword: string, accountId: string): Promise<any[]> {
    try {
      const results = await this.instagramService.searchPosts(accessToken, keyword, {
        maxResults: 50,
        instagramBusinessAccountId: accountId,
      });

      return results.map((post: any) => ({
        postId: post.id,
        content: post.caption || '',
        author: post.username || 'Unknown',
        authorId: post.user_id || '',
        authorProfileUrl: `https://instagram.com/${post.username}`,
        postUrl: post.permalink || `https://instagram.com/p/${post.id}`,
        timestamp: new Date(post.timestamp),
      }));
    } catch (error) {
      this.logger.error(`Instagram scan error: ${error}`);
      return [];
    }
  }

  /**
   * Scan Twitter for keyword mentions
   */
  private async scanTwitter(accessToken: string, keyword: string): Promise<any[]> {
    try {
      const results = await this.twitterService.searchTweets(accessToken, keyword, { maxResults: 50 });

      return results.map((tweet: any) => ({
        postId: tweet.id,
        content: tweet.text || '',
        author: tweet.author?.username || 'Unknown',
        authorId: tweet.author?.id || '',
        authorProfileUrl: `https://twitter.com/${tweet.author?.username}`,
        postUrl: `https://twitter.com/${tweet.author?.username}/status/${tweet.id}`,
        timestamp: new Date(tweet.created_at),
      }));
    } catch (error) {
      this.logger.error(`Twitter scan error: ${error}`);
      return [];
    }
  }

  /**
   * Scan LinkedIn for keyword mentions
   */
  private async scanLinkedIn(accessToken: string, keyword: string): Promise<any[]> {
    try {
      const results = await this.linkedinService.searchPosts(accessToken, keyword, { maxResults: 50 });

      return results.map((post: any) => ({
        postId: post.id,
        content: post.commentary || post.text || '',
        author: post.author?.name || 'Unknown',
        authorId: post.author?.id || '',
        authorProfileUrl: post.author?.profileUrl || '',
        postUrl: post.shareUrl || '',
        timestamp: new Date(post.createdAt),
      }));
    } catch (error) {
      this.logger.error(`LinkedIn scan error: ${error}`);
      return [];
    }
  }

  /**
   * Scan Reddit for keyword mentions (public API)
   */
  private async scanReddit(keyword: string): Promise<any[]> {
    try {
      // Use Reddit's public API to search
      const response = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=new&limit=50`,
        {
          headers: {
            'User-Agent': 'AI Marketing Agency Bot 1.0',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.statusText}`);
      }

      const data = await response.json();
      const posts = data.data?.children || [];

      return posts.map((item: any) => {
        const post = item.data;
        return {
          postId: post.id,
          content: post.title + ' ' + (post.selftext || ''),
          author: post.author || 'Unknown',
          authorId: post.author || '',
          authorProfileUrl: `https://reddit.com/user/${post.author}`,
          postUrl: `https://reddit.com${post.permalink}`,
          timestamp: new Date(post.created_utc * 1000),
        };
      });
    } catch (error) {
      this.logger.error(`Reddit scan error: ${error}`);
      return [];
    }
  }

  /**
   * Calculate top keywords from matches
   */
  private calculateTopKeywords(matches: any[]): { keyword: string; count: number }[] {
    const keywordCounts: Map<string, number> = new Map();

    matches.forEach((match) => {
      const keywords = match.matchedKeywords as string[];
      keywords.forEach((keyword) => {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      });
    });

    return Array.from(keywordCounts.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Update campaign status
   */
  async updateCampaignStatus(campaignId: string, isActive: boolean): Promise<void> {
    await this.prisma.keywordCampaign.update({
      where: { id: campaignId },
      data: { isActive },
    });

    if (!isActive) {
      this.activeCampaigns.delete(campaignId);
    }
  }

  /**
   * Delete a campaign
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    // Delete all associated matches first
    await this.prisma.keywordMatch.deleteMany({
      where: { campaignId },
    });

    // Delete the campaign
    await this.prisma.keywordCampaign.delete({
      where: { id: campaignId },
    });

    this.activeCampaigns.delete(campaignId);
  }
}

