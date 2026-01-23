import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TwitterService } from '../../integrations/social/twitter.service';
import { InstagramService } from '../../integrations/social/instagram.service';
import { FacebookService } from '../../integrations/social/facebook.service';
import { LinkedInService } from '../../integrations/social/linkedin.service';
import { TikTokService } from '../../integrations/social/tiktok.service';
import { SocialPlatform } from '@prisma/client';

export interface HashtagSearchResult {
  platform: SocialPlatform;
  keyword: string;
  results: any[];
  totalCount: number;
  error?: string;
}

export interface HashtagSearchResponse {
  searchId: string;
  keyword: string;
  status: string;
  totalResults: number;
  platformResults: {
    [key: string]: HashtagSearchResult;
  };
  createdAt: Date;
  completedAt?: Date;
}

@Injectable()
export class HashtagSearchService {
  private readonly logger = new Logger(HashtagSearchService.name);

  constructor(
    private prisma: PrismaService,
    private twitterService: TwitterService,
    private instagramService: InstagramService,
    private facebookService: FacebookService,
    private linkedinService: LinkedInService,
    private tiktokService: TikTokService,
  ) {}

  /**
   * Search for hashtags/keywords across all social media platforms
   */
  async searchHashtags(
    userId: string,
    keyword: string,
    options: {
      maxResultsPerPlatform?: number;
      platforms?: SocialPlatform[];
    } = {},
  ): Promise<HashtagSearchResponse> {
    const maxResults = options.maxResultsPerPlatform || 20;
    const platformsToSearch = options.platforms || [
      SocialPlatform.TWITTER,
      SocialPlatform.INSTAGRAM,
      SocialPlatform.FACEBOOK,
      SocialPlatform.LINKEDIN,
      SocialPlatform.TIKTOK,
    ];

    // Create search record
    const search = await this.prisma.hashtagSearch.create({
      data: {
        userId,
        keyword,
        status: 'IN_PROGRESS',
      },
    });

    try {
      this.logger.log(`Starting hashtag search for keyword: ${keyword} by user: ${userId}`);

      // Search all platforms in parallel
      const searchPromises = platformsToSearch.map((platform) =>
        this.searchPlatform(platform, keyword, maxResults).catch((error) => {
          this.logger.error(`Error searching ${platform}: ${error.message}`);
          return {
            platform,
            keyword,
            results: [],
            totalCount: 0,
            error: error.message,
          } as HashtagSearchResult;
        }),
      );

      const platformResults = await Promise.all(searchPromises);

      // Convert to map for easier access
      const resultsMap: { [key: string]: HashtagSearchResult } = {};
      let totalResults = 0;

      for (const result of platformResults) {
        resultsMap[result.platform] = result;
        totalResults += result.totalCount;

        // Save results to database
        await this.savePlatformResults(search.id, result);
      }

      // Update search status
      await this.prisma.hashtagSearch.update({
        where: { id: search.id },
        data: {
          status: 'COMPLETED',
          totalResults,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Hashtag search completed for keyword: ${keyword}. Total results: ${totalResults}`,
      );

      return {
        searchId: search.id,
        keyword,
        status: 'COMPLETED',
        totalResults,
        platformResults: resultsMap,
        createdAt: search.createdAt,
        completedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Hashtag search failed: ${error instanceof Error ? error.message : String(error)}`);

      // Update search status to failed
      await this.prisma.hashtagSearch.update({
        where: { id: search.id },
        data: {
          status: 'FAILED',
        },
      });

      throw error;
    }
  }

  /**
   * Search a specific platform for hashtags/keywords
   */
  private async searchPlatform(
    platform: SocialPlatform,
    keyword: string,
    maxResults: number,
  ): Promise<HashtagSearchResult> {
    this.logger.log(`Searching ${platform} for keyword: ${keyword}`);

    let results: any[] = [];

    switch (platform) {
      case SocialPlatform.TWITTER:
        const twitterPosts = await this.twitterService.searchHashtags('', keyword, {
          maxResults,
        });
        results = twitterPosts.map((post: any) => ({
          postId: post.id,
          postUrl: `https://twitter.com/i/web/status/${post.id}`,
          authorUsername: post.author?.username,
          authorId: post.author?.id,
          content: post.text,
          mediaUrl: undefined,
          metrics: post.metrics,
          engagementRate: this.calculateEngagementRate(post.metrics),
          postedAt: post.created_at,
        }));
        break;

      case SocialPlatform.INSTAGRAM:
        const instagramPosts = await this.instagramService.searchHashtags(keyword, undefined, {
          maxResults,
        });
        results = instagramPosts.map((post: any) => ({
          postId: post.id,
          postUrl: post.permalink,
          authorUsername: post.author?.username,
          authorId: post.author?.id,
          content: post.caption,
          mediaUrl: post.mediaUrl,
          metrics: post.metrics,
          engagementRate: this.calculateEngagementRate(post.metrics),
          postedAt: post.postedAt,
        }));
        break;

      case SocialPlatform.FACEBOOK:
        const facebookPosts = await this.facebookService.searchHashtags(keyword, undefined, {
          maxResults,
        });
        results = facebookPosts.map((post: any) => ({
          postId: post.id,
          postUrl: post.permalink,
          authorUsername: post.author?.name,
          authorId: post.author?.id,
          content: post.message,
          mediaUrl: undefined,
          metrics: post.metrics,
          engagementRate: this.calculateEngagementRate(post.metrics),
          postedAt: post.postedAt,
        }));
        break;

      case SocialPlatform.LINKEDIN:
        const linkedinPosts = await this.linkedinService.searchHashtags(keyword, undefined, {
          maxResults,
        });
        results = linkedinPosts.map((post: any) => ({
          postId: post.id,
          postUrl: post.permalink,
          authorUsername: post.author?.name,
          authorId: post.author?.id,
          content: post.text,
          mediaUrl: undefined,
          metrics: post.metrics,
          engagementRate: this.calculateEngagementRate(post.metrics),
          postedAt: post.postedAt,
        }));
        break;

      case SocialPlatform.TIKTOK:
        const tiktokResult = await this.tiktokService.searchHashtags(keyword, {
          maxResults,
        });
        results = tiktokResult.posts.map((post) => ({
          postId: post.id,
          postUrl: post.videoUrl,
          authorUsername: post.author.username,
          authorId: post.author.id,
          content: post.text,
          mediaUrl: post.thumbnailUrl,
          metrics: post.metrics,
          engagementRate: this.calculateEngagementRate(post.metrics),
          postedAt: post.createdAt,
        }));
        break;

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    return {
      platform,
      keyword,
      results,
      totalCount: results.length,
    };
  }

  /**
   * Save platform results to database
   */
  private async savePlatformResults(
    searchId: string,
    result: HashtagSearchResult,
  ): Promise<void> {
    const resultsToCreate = result.results.map((item) => ({
      searchId,
      platform: result.platform,
      keyword: result.keyword,
      hashtag: `#${result.keyword}`,
      postId: item.postId,
      postUrl: item.postUrl,
      authorUsername: item.authorUsername,
      authorId: item.authorId,
      content: item.content,
      mediaUrl: item.mediaUrl,
      metrics: item.metrics,
      engagementRate: item.engagementRate,
      postedAt: item.postedAt,
    }));

    // Batch create results
    await this.prisma.hashtagSearchResult.createMany({
      data: resultsToCreate,
    });
  }

  /**
   * Calculate engagement rate from metrics
   */
  private calculateEngagementRate(metrics: any): number {
    if (!metrics) return 0;

    const likes = metrics.likes || 0;
    const comments = metrics.comments || 0;
    const shares = metrics.shares || 0;
    const views = metrics.views || metrics.impressions || 1;

    const totalEngagement = likes + comments + shares;
    return views > 0 ? (totalEngagement / views) * 100 : 0;
  }

  /**
   * Get search history for a user
   */
  async getSearchHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    const searches = await this.prisma.hashtagSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        results: {
          select: {
            platform: true,
            id: true,
          },
        },
      },
    });

    return searches.map((search) => ({
      id: search.id,
      keyword: search.keyword,
      status: search.status,
      totalResults: search.totalResults,
      createdAt: search.createdAt,
      completedAt: search.completedAt,
      platformCounts: this.groupResultsByPlatform(search.results),
    }));
  }

  /**
   * Get search results by search ID
   */
  async getSearchResults(searchId: string, userId: string) {
    const search = await this.prisma.hashtagSearch.findFirst({
      where: {
        id: searchId,
        userId,
      },
      include: {
        results: {
          orderBy: { postedAt: 'desc' },
        },
      },
    });

    if (!search) {
      throw new Error('Search not found');
    }

    // Group results by platform
    const platformResults: { [key: string]: any[] } = {};
    for (const result of search.results) {
      if (!platformResults[result.platform]) {
        platformResults[result.platform] = [];
      }
      platformResults[result.platform].push({
        id: result.id,
        postId: result.postId,
        postUrl: result.postUrl,
        authorUsername: result.authorUsername,
        authorId: result.authorId,
        content: result.content,
        mediaUrl: result.mediaUrl,
        metrics: result.metrics,
        engagementRate: result.engagementRate,
        postedAt: result.postedAt,
      });
    }

    return {
      searchId: search.id,
      keyword: search.keyword,
      status: search.status,
      totalResults: search.totalResults,
      platformResults,
      createdAt: search.createdAt,
      completedAt: search.completedAt,
    };
  }

  /**
   * Group results by platform
   */
  private groupResultsByPlatform(results: any[]): { [key: string]: number } {
    const counts: { [key: string]: number } = {};
    for (const result of results) {
      counts[result.platform] = (counts[result.platform] || 0) + 1;
    }
    return counts;
  }
}

