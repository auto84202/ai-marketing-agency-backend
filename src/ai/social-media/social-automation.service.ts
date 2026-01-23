import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAI } from 'openai';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface PostGenerationRequest {
  topic: string;
  platform: string;
  tone?: 'professional' | 'casual' | 'humorous' | 'inspirational' | 'educational';
  length?: 'short' | 'medium' | 'long';
  includeHashtags?: boolean;
  includeEmojis?: boolean;
  targetAudience?: string;
  keywords?: string[];
  callToAction?: string;
  generateVariations?: number;
}

export interface GeneratedPost {
  content: string;
  caption?: string;
  hashtags: string[];
  suggestedMedia?: string[];
  engagementPrediction: number;
  optimalPostTime?: Date;
  targetAudience?: any;
  variations?: Array<{
    content: string;
    caption?: string;
    hashtags: string[];
    tone: string;
    score: number;
  }>;
}

export interface HashtagAnalysis {
  hashtag: string;
  volume: number;
  engagementRate: number;
  competition: 'low' | 'medium' | 'high';
  relevance: number;
  trending: boolean;
  relatedHashtags: string[];
}

export interface OptimalPostingTime {
  platform: string;
  dayOfWeek: string;
  timeSlot: string;
  engagementScore: number;
  confidence: number;
  reasoning: string;
}

@Injectable()
export class SocialAutomationService {
  private readonly logger = new Logger(SocialAutomationService.name);
  private openai: OpenAI;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.openai = null as any;
    }
  }

  /**
   * Auto-generate social media post with AI
   */
  async generatePost(
    userId: string,
    request: PostGenerationRequest,
  ): Promise<GeneratedPost> {
    try {
      this.logger.log(`Generating ${request.platform} post for user: ${userId}`);

      // Generate main content using AI
      const mainContent = await this.generateContentWithAI(request);
      
      // Generate hashtags
      const hashtags = await this.generateHashtags(request.topic, request.platform, request.keywords);
      
      // Generate variations if requested
      let variations = [];
      if (request.generateVariations && request.generateVariations > 0) {
        variations = await this.generateContentVariations(request, request.generateVariations);
      }

      // Predict engagement score
      const engagementPrediction = await this.predictEngagement(mainContent, hashtags, request.platform);
      
      // Get optimal posting time
      const optimalTime = await this.getOptimalPostingTime(userId, request.platform);

      // Save generated post to database
      const post = await this.prisma.socialPost.create({
        data: {
          userId,
          platform: request.platform as any,
          content: mainContent.content,
          caption: mainContent.caption,
          hashtags: hashtags.join(' '),
          aiGenerated: true,
          generationPrompt: JSON.stringify(request),
          engagementScore: engagementPrediction,
          optimalPostTime: optimalTime?.datetime,
          targetAudience: request.targetAudience ? { audience: request.targetAudience } : undefined,
          status: 'DRAFT',
          mediaUrls: '',
        },
      });

      return {
        content: mainContent.content,
        caption: mainContent.caption,
        hashtags,
        engagementPrediction,
        optimalPostTime: optimalTime?.datetime,
        targetAudience: request.targetAudience,
        variations,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate post: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate content using OpenAI
   */
  private async generateContentWithAI(request: PostGenerationRequest): Promise<{ content: string; caption?: string }> {
    if (!this.openai) {
      return this.generateMockContent(request);
    }

    try {
      const platformGuidelines = this.getPlatformGuidelines(request.platform);
      
      const prompt = `
        Generate a ${request.tone || 'engaging'} social media post for ${request.platform}.
        
        Topic: ${request.topic}
        ${request.targetAudience ? `Target Audience: ${request.targetAudience}` : ''}
        ${request.keywords ? `Keywords to include: ${request.keywords.join(', ')}` : ''}
        ${request.callToAction ? `Call to Action: ${request.callToAction}` : ''}
        
        Platform Guidelines:
        - Character limit: ${platformGuidelines.charLimit}
        - Best practices: ${platformGuidelines.bestPractices}
        
        Requirements:
        - Length: ${request.length || 'medium'}
        - ${request.includeEmojis !== false ? 'Include relevant emojis' : 'No emojis'}
        - Make it engaging and shareable
        - Follow ${request.platform} best practices
        ${request.platform === 'LINKEDIN' ? '- Professional tone with insights' : ''}
        ${request.platform === 'TWITTER' ? '- Concise and impactful' : ''}
        ${request.platform === 'INSTAGRAM' ? '- Visual-focused with storytelling' : ''}
        ${request.platform === 'TIKTOK' ? '- Trending and entertaining' : ''}
        
        Format the response as JSON:
        {
          "content": "main post content",
          "caption": "optional caption for image/video posts"
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No content generated');

      try {
        return JSON.parse(content);
      } catch {
        return { content: content };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI content generation failed, using mock data: ${msg}`);
      return this.generateMockContent(request);
    }
  }

  /**
   * Generate hashtags for the post
   */
  async generateHashtags(
    topic: string,
    platform: string,
    keywords?: string[],
  ): Promise<string[]> {
    if (!this.openai) {
      return this.generateMockHashtags(topic);
    }

    try {
      const prompt = `
        Generate 10-15 relevant, trending hashtags for a ${platform} post about: ${topic}
        ${keywords ? `Include these keywords: ${keywords.join(', ')}` : ''}
        
        Mix of:
        - 3-5 highly popular hashtags (100k+ uses)
        - 5-7 moderately popular hashtags (10k-100k uses)
        - 2-3 niche-specific hashtags (1k-10k uses)
        
        Return as a JSON array of strings (hashtags without #):
        ["hashtag1", "hashtag2", ...]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No hashtags generated');

      const hashtags = JSON.parse(content);
      return Array.isArray(hashtags) ? hashtags.map(h => h.startsWith('#') ? h.slice(1) : h) : [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI hashtag generation failed, using mock data: ${msg}`);
      return this.generateMockHashtags(topic);
    }
  }

  /**
   * Generate content variations
   */
  private async generateContentVariations(
    request: PostGenerationRequest,
    count: number,
  ): Promise<any[]> {
    const variations = [];
    const tones = ['professional', 'casual', 'humorous', 'inspirational'];
    
    for (let i = 0; i < Math.min(count, 4); i++) {
      const tone = tones[i % tones.length];
      const variantRequest = { ...request, tone: tone as any };
      
      try {
        const content = await this.generateContentWithAI(variantRequest);
        const hashtags = await this.generateHashtags(request.topic, request.platform);
        const score = await this.predictEngagement(content, hashtags, request.platform);
        
        variations.push({
          content: content.content,
          caption: content.caption,
          hashtags,
          tone,
          score,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to generate variation ${i}: ${msg}`);
      }
    }

    return variations.sort((a, b) => b.score - a.score);
  }

  /**
   * Predict engagement score for post
   */
  private async predictEngagement(
    content: any,
    hashtags: string[],
    platform: string,
  ): Promise<number> {
    // Simplified engagement prediction based on various factors
    let score = 50; // Base score

    const text = typeof content === 'string' ? content : content.content;
    
    // Content length factor
    const wordCount = text.split(' ').length;
    if (platform === 'TWITTER' && wordCount >= 15 && wordCount <= 30) score += 10;
    if (platform === 'LINKEDIN' && wordCount >= 100 && wordCount <= 300) score += 15;
    if (platform === 'INSTAGRAM' && wordCount >= 50 && wordCount <= 150) score += 12;
    
    // Hashtag factor
    if (hashtags.length >= 5 && hashtags.length <= 15) score += 10;
    if (hashtags.length > 20) score -= 5; // Too many hashtags
    
    // Emoji factor
    const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length;
    if (emojiCount >= 1 && emojiCount <= 3) score += 8;
    
    // Question mark (engagement trigger)
    if (text.includes('?')) score += 5;
    
    // Call to action
    const ctas = ['click', 'share', 'comment', 'like', 'follow', 'learn more', 'check out'];
    if (ctas.some(cta => text.toLowerCase().includes(cta))) score += 7;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get optimal posting time based on analytics
   */
  async getOptimalPostingTime(
    userId: string,
    platform: string,
  ): Promise<{ datetime: Date; score: number; reasoning: string } | null> {
    try {
      // Get historical post schedules for this user and platform
      const accounts = await this.prisma.socialMediaAccount.findMany({
        where: { userId, platform: platform as any },
        include: {
          schedules: {
            where: { isOptimal: true },
            orderBy: { engagementScore: 'desc' },
            take: 5,
          },
        },
      });

      if (accounts.length === 0 || accounts[0].schedules.length === 0) {
        // Return default optimal times based on platform
        return this.getDefaultOptimalTime(platform);
      }

      // Find the best time slot
      const bestSchedule = accounts[0].schedules[0];
      const now = new Date();
      const targetDate = new Date(now);
      
      // Find next occurrence of this day and time
      const targetDay = bestSchedule.dayOfWeek;
      const daysUntilTarget = (targetDay - now.getDay() + 7) % 7 || 7;
      targetDate.setDate(now.getDate() + daysUntilTarget);
      
      const [hours, minutes] = bestSchedule.timeSlot.split(':').map(Number);
      targetDate.setHours(hours, minutes, 0, 0);

      return {
        datetime: targetDate,
        score: bestSchedule.engagementScore || 75,
        reasoning: `Based on historical data, ${this.getDayName(targetDay)} at ${bestSchedule.timeSlot} has ${bestSchedule.avgEngagementRate}% engagement rate`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to get optimal posting time: ${msg}`);
      return this.getDefaultOptimalTime(platform);
    }
  }

  /**
   * Get default optimal time based on platform
   */
  private getDefaultOptimalTime(platform: string): { datetime: Date; score: number; reasoning: string } {
    const now = new Date();
    const optimalTimes: Record<string, { day: number; hour: number; minute: number }> = {
      TWITTER: { day: 3, hour: 12, minute: 0 }, // Wednesday noon
      INSTAGRAM: { day: 5, hour: 11, minute: 0 }, // Friday 11 AM
      LINKEDIN: { day: 2, hour: 8, minute: 0 }, // Tuesday 8 AM
      FACEBOOK: { day: 4, hour: 13, minute: 0 }, // Thursday 1 PM
      TIKTOK: { day: 2, hour: 19, minute: 0 }, // Tuesday 7 PM
    };

    const optimal = optimalTimes[platform] || optimalTimes.INSTAGRAM;
    const targetDate = new Date(now);
    const daysUntilTarget = (optimal.day - now.getDay() + 7) % 7 || 7;
    targetDate.setDate(now.getDate() + daysUntilTarget);
    targetDate.setHours(optimal.hour, optimal.minute, 0, 0);

    return {
      datetime: targetDate,
      score: 70,
      reasoning: `Industry best practice for ${platform}`,
    };
  }

  /**
   * Analyze hashtag performance
   */
  async analyzeHashtags(hashtags: string[], platform: string): Promise<HashtagAnalysis[]> {
    const analyses: HashtagAnalysis[] = [];

    for (const hashtag of hashtags) {
      // In production, this would query real-time data from social media APIs
      const analysis: HashtagAnalysis = {
        hashtag: hashtag.startsWith('#') ? hashtag : `#${hashtag}`,
        volume: Math.floor(Math.random() * 1000000) + 10000,
        engagementRate: Math.random() * 5 + 1,
        competition: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
        relevance: Math.random() * 40 + 60,
        trending: Math.random() > 0.7,
        relatedHashtags: this.generateRelatedHashtags(hashtag),
      };

      analyses.push(analysis);
    }

    return analyses.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Schedule post at optimal time
   */
  async schedulePost(
    userId: string,
    postId: string,
    scheduledTime?: Date,
  ): Promise<any> {
    try {
      const post = await this.prisma.socialPost.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error('Post not found');
      }

      // If no specific time provided, use optimal time
      let finalScheduleTime = scheduledTime;
      if (!finalScheduleTime) {
        const optimal = await this.getOptimalPostingTime(userId, post.platform);
        finalScheduleTime = optimal?.datetime || new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // Update post with schedule
      const updated = await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          scheduledAt: finalScheduleTime,
          status: 'SCHEDULED',
          autoScheduled: !scheduledTime, // True if we auto-determined the time
        },
      });

      this.logger.log(`Post ${postId} scheduled for ${finalScheduleTime}`);
      return updated;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to schedule post: ${msg}`);
      throw error;
    }
  }

  /**
   * Publish scheduled posts (run by cron)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async publishScheduledPosts(): Promise<void> {
    try {
      const now = new Date();
      const postsToPublish = await this.prisma.socialPost.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: {
            lte: now,
          },
        },
        include: {
          user: {
            include: {
              socialMediaAccounts: true,
            },
          },
        },
        take: 10, // Process in batches
      });

      for (const post of postsToPublish) {
        try {
          await this.publishPost(post);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to publish post ${post.id}: ${msg}`);
          
          // Update post status to failed
          await this.prisma.socialPost.update({
            where: { id: post.id },
            data: { status: 'FAILED' },
          });
        }
      }

      if (postsToPublish.length > 0) {
        this.logger.log(`Published ${postsToPublish.length} scheduled posts`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in publishScheduledPosts: ${msg}`);
    }
  }

  /**
   * Publish post to platform
   */
  private async publishPost(post: any): Promise<void> {
    // Find the social media account for this platform
    const account = post.user.socialMediaAccounts?.find(
      (acc: any) => acc.platform === post.platform && acc.isActive
    );

    if (!account) {
      throw new Error(`No active ${post.platform} account found for user`);
    }

    // In production, this would use platform-specific APIs
    // For now, we'll simulate the publishing
    await this.simulatePublish(post, account);

    // Update post status
    await this.prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: 'PUBLISHED',
        postedAt: new Date(),
        platformPostId: `mock_${Date.now()}`, // Would be real platform ID
      },
    });

    this.logger.log(`Published post ${post.id} to ${post.platform}`);
  }

  /**
   * Simulate publishing (replace with real API calls)
   */
  private async simulatePublish(post: any, account: any): Promise<void> {
    // This would be replaced with actual platform API calls:
    // - Twitter API
    // - Instagram Graph API
    // - LinkedIn API
    // - TikTok API
    // - Facebook Graph API
    
    await new Promise(resolve => setTimeout(resolve, 100));
    this.logger.log(`Simulated publish to ${post.platform}`);
  }

  /**
   * Helper methods
   */
  private getPlatformGuidelines(platform: string): any {
    const guidelines: Record<string, { charLimit: number; bestPractices: string }> = {
      TWITTER: {
        charLimit: 280,
        bestPractices: 'Concise, use hashtags (1-2), tag relevant accounts, use threads for longer content',
      },
      INSTAGRAM: {
        charLimit: 2200,
        bestPractices: 'Visual-first, storytelling, 5-10 hashtags, ask questions, use first comment for additional hashtags',
      },
      LINKEDIN: {
        charLimit: 3000,
        bestPractices: 'Professional, value-driven, insights, industry trends, 3-5 hashtags, engage with comments',
      },
      FACEBOOK: {
        charLimit: 63206,
        bestPractices: 'Engaging, conversational, mix of content types, ask questions, create discussions',
      },
      TIKTOK: {
        charLimit: 150,
        bestPractices: 'Trending, entertaining, use trending sounds/hashtags, clear hook in first 3 seconds',
      },
    };

    return guidelines[platform] || guidelines.INSTAGRAM;
  }

  private generateMockContent(request: PostGenerationRequest): { content: string; caption?: string } {
    const content = `🚀 Exciting insights on ${request.topic}!\n\n${request.tone === 'professional' ? 'In today\'s rapidly evolving landscape,' : 'Let me share something cool with you -'} ${request.topic} is transforming the way we work and live.\n\n${request.callToAction || 'What are your thoughts?'} 💭`;
    
    return { content };
  }

  private generateMockHashtags(topic: string): string[] {
    const words = topic.toLowerCase().split(' ');
    const baseHashtags = words.map(w => w.replace(/[^a-z0-9]/g, ''));
    
    return [
      ...baseHashtags,
      'trending',
      'viral',
      'socialmedia',
      'marketing',
      'growth',
      'business',
      'entrepreneur',
      'success',
    ].slice(0, 10);
  }

  private generateRelatedHashtags(hashtag: string): string[] {
    const base = hashtag.replace('#', '');
    return [
      `${base}tips`,
      `${base}marketing`,
      `${base}strategy`,
      `${base}growth`,
      `${base}success`,
    ].slice(0, 3);
  }

  private getDayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day];
  }
}
