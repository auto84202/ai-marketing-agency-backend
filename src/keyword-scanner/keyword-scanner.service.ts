import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAIService } from '../integrations/openai/openai.service';
import { FacebookService } from '../integrations/social/facebook.service';
import { InstagramService } from '../integrations/social/instagram.service';

export interface KeywordResult {
  platform: 'facebook' | 'instagram' | 'x';
  content: string;
  author: string;
  location?: string;
  timestamp: string;
  engagement: {
    likes: number;
    comments: number;
    shares: number;
  };
  url?: string;
}

@Injectable()
export class KeywordScannerService {
  private readonly logger = new Logger(KeywordScannerService.name);

  constructor(
    private prisma: PrismaService,
    private openAIService: OpenAIService,
    private facebookService: FacebookService,
    private instagramService: InstagramService,
  ) {}

  async scanKeyword(
    keyword: string,
    platforms: string[],
    userId: string,
  ): Promise<KeywordResult[]> {
    const results: KeywordResult[] = [];

    this.logger.log(`Scanning keyword "${keyword}" on platforms: ${platforms.join(', ')}`);

    // Scan Facebook - Use real API
    if (platforms.includes('facebook')) {
      const facebookResults = await this.scanFacebookAPI(keyword);
      results.push(...facebookResults);
      
      // Also scan database posts
      const dbFacebookResults = await this.scanFacebook(keyword, userId);
      results.push(...dbFacebookResults);
    }

    // Scan Instagram - Use real API
    if (platforms.includes('instagram')) {
      const instagramResults = await this.scanInstagramAPI(keyword);
      results.push(...instagramResults);
      
      // Also scan database posts
      const dbInstagramResults = await this.scanInstagram(keyword, userId);
      results.push(...dbInstagramResults);
    }

    // Scan X (Twitter) - Database only
    if (platforms.includes('x')) {
      const xResults = await this.scanX(keyword, userId);
      results.push(...xResults);
    }

    // Remove duplicates based on content and timestamp
    const uniqueResults = results.filter((result, index, self) =>
      index === self.findIndex(r => 
        r.content === result.content && r.timestamp === result.timestamp
      )
    );

    // Sort by timestamp (most recent first)
    uniqueResults.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    this.logger.log(`Found ${uniqueResults.length} results for keyword "${keyword}"`);

    return uniqueResults;
  }

  /**
   * Scan Facebook using real API
   */
  private async scanFacebookAPI(keyword: string): Promise<KeywordResult[]> {
    try {
      const posts = await this.facebookService.searchPostsByKeyword(keyword, 50);
      
      return posts.map((post: any) => ({
        platform: 'facebook' as const,
        content: post.message || '',
        author: 'Your Facebook Page',
        timestamp: post.createdTime?.toISOString() || new Date().toISOString(),
        engagement: {
          likes: post.metrics?.likes || 0,
          comments: post.metrics?.comments || 0,
          shares: post.metrics?.shares || 0,
        },
        url: post.permalink,
      }));
    } catch (error) {
      this.logger.error(`Error scanning Facebook API: ${error}`);
      return [];
    }
  }

  /**
   * Scan Instagram using real API
   */
  private async scanInstagramAPI(keyword: string): Promise<KeywordResult[]> {
    try {
      const posts = await this.instagramService.searchPostsByKeyword(keyword, 50);
      
      return posts.map((post: any) => ({
        platform: 'instagram' as const,
        content: post.caption || '',
        author: 'Your Instagram Account',
        timestamp: post.createdTime?.toISOString() || new Date().toISOString(),
        engagement: {
          likes: post.metrics?.likes || 0,
          comments: post.metrics?.comments || 0,
          shares: post.metrics?.shares || 0,
        },
        url: post.permalink,
      }));
    } catch (error) {
      this.logger.error(`Error scanning Instagram API: ${error}`);
      return [];
    }
  }

  private async scanFacebook(
    keyword: string,
    userId: string,
  ): Promise<KeywordResult[]> {
    try {
      // Get user's Facebook posts
      const posts = await this.prisma.socialPost.findMany({
        where: {
          campaign: {
            userId,
          },
          platform: 'FACEBOOK',
          OR: [
            { content: { contains: keyword, mode: 'insensitive' } },
            { hashtags: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: {
          campaign: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

      return posts.map((post: any) => ({
        platform: 'facebook' as const,
        content: post.content || '',
        author: post.campaign?.name || 'Your Campaign',
        location: (post.metadata as any)?.location,
        timestamp: post.createdAt.toISOString(),
        engagement: {
          likes: (post.metrics as any)?.likes || 0,
          comments: (post.metrics as any)?.comments || 0,
          shares: (post.metrics as any)?.shares || 0,
        },
        url: post.permalink || undefined,
      }));
    } catch (error) {
      console.error('Error scanning Facebook:', error);
      return [];
    }
  }

  private async scanInstagram(
    keyword: string,
    userId: string,
  ): Promise<KeywordResult[]> {
    try {
      // Get user's Instagram posts
      const posts = await this.prisma.socialPost.findMany({
        where: {
          campaign: {
            userId,
          },
          platform: 'INSTAGRAM',
          OR: [
            { content: { contains: keyword, mode: 'insensitive' } },
            { hashtags: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: {
          campaign: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

      return posts.map((post: any) => ({
        platform: 'instagram' as const,
        content: post.content || '',
        author: post.campaign?.name || 'Your Campaign',
        location: (post.metadata as any)?.location,
        timestamp: post.createdAt.toISOString(),
        engagement: {
          likes: (post.metrics as any)?.likes || 0,
          comments: (post.metrics as any)?.comments || 0,
          shares: (post.metrics as any)?.shares || 0,
        },
        url: post.permalink || undefined,
      }));
    } catch (error) {
      console.error('Error scanning Instagram:', error);
      return [];
    }
  }

  private async scanX(
    keyword: string,
    userId: string,
  ): Promise<KeywordResult[]> {
    try {
      // Get user's X (Twitter) posts
      const posts = await this.prisma.socialPost.findMany({
        where: {
          campaign: {
            userId,
          },
          platform: 'TWITTER',
          OR: [
            { content: { contains: keyword, mode: 'insensitive' } },
            { hashtags: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: {
          campaign: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

      return posts.map((post: any) => ({
        platform: 'x' as const,
        content: post.content || '',
        author: post.campaign?.name || 'Your Campaign',
        location: (post.metadata as any)?.location,
        timestamp: post.createdAt.toISOString(),
        engagement: {
          likes: (post.metrics as any)?.likes || 0,
          comments: (post.metrics as any)?.retweets || 0,
          shares: (post.metrics as any)?.replies || 0,
        },
        url: post.permalink || undefined,
      }));
    } catch (error) {
      console.error('Error scanning X:', error);
      return [];
    }
  }

  async chatWithAI(
    message: string,
    context: any,
    userId: string,
  ): Promise<string> {
    try {
      // Build context for AI
      const contextInfo = context.results
        ? `
Current keyword being analyzed: "${context.keyword}"
Total results found: ${context.results.length}
Platforms scanned: ${Object.entries(context.platforms)
            .filter(([_, selected]) => selected)
            .map(([platform]) => platform)
            .join(', ')}

Sample results:
${context.results
  .slice(0, 5)
  .map(
    (r: KeywordResult, i: number) => `
${i + 1}. Platform: ${r.platform}
   Content: ${r.content.substring(0, 150)}...
   Engagement: ${r.engagement.likes} likes, ${r.engagement.comments} comments, ${r.engagement.shares} shares
`,
  )
  .join('\n')}
`
        : 'No scan results available yet.';

      const systemPrompt = `You are an AI assistant specialized in social media keyword analysis and digital marketing insights. 

${contextInfo}

Provide helpful, insightful responses about keyword trends, engagement patterns, and social media presence. Be specific and actionable. If asked about locations, analyze where the keyword appears most frequently across the platforms.`;

      // Use OpenAI service
      const response = await this.openAIService.generateText(message, {
        systemPrompt,
        temperature: 0.7,
        maxTokens: 500,
        model: 'gpt-4',
      });

      return response.content;
    } catch (error) {
      console.error('Error with AI chat:', error);
      return 'I apologize, but I encountered an error processing your request. Please try again or rephrase your question.';
    }
  }
}

