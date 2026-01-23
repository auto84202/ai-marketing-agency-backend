import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAI } from 'openai';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface ContentRecommendationRequest {
  userId: string;
  platform: string;
  goals?: string[]; // 'engagement', 'growth', 'sales', 'awareness'
  currentFollowers?: number;
  targetAudience?: string;
}

export interface PersonalizedRecommendation {
  contentType: string; // 'post', 'story', 'reel', 'video', 'carousel'
  topic: string;
  style: string; // 'professional', 'casual', 'humorous', 'educational', 'inspirational'
  frequency: string; // 'daily', '3x_week', 'weekly', 'bi_weekly'
  bestTimes: Array<{
    day: string;
    time: string;
    score: number;
  }>;
  trendingTopics: string[];
  hashtagSuggestions: string[];
  contentIdeas: Array<{
    idea: string;
    format: string;
    estimatedEngagement: number;
    difficulty: 'easy' | 'medium' | 'hard';
  }>;
  confidence: number;
  reasoning: string;
}

export interface ContentCalendar {
  userId: string;
  platform: string;
  month: string;
  recommendations: Array<{
    date: Date;
    contentType: string;
    topic: string;
    hashtags: string[];
    bestTime: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

@Injectable()
export class ContentRecommendationService {
  private readonly logger = new Logger(ContentRecommendationService.name);
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
   * Generate personalized content recommendations
   */
  async getPersonalizedRecommendations(
    request: ContentRecommendationRequest,
  ): Promise<PersonalizedRecommendation[]> {
    try {
      this.logger.log(`Generating recommendations for user: ${request.userId} on ${request.platform}`);

      // Analyze user's content history
      const contentAnalysis = await this.analyzeUserContent(request.userId, request.platform);
      
      // Get engagement analytics
      const engagementData = await this.getEngagementAnalytics(request.userId, request.platform);
      
      // Get trending topics relevant to user
      const trendingTopics = await this.getRelevantTrends(request.userId, request.platform);
      
      // Generate AI-powered recommendations
      const recommendations = await this.generateRecommendationsWithAI(
        request,
        contentAnalysis,
        engagementData,
        trendingTopics,
      );

      // Save recommendations to database
      for (const rec of recommendations) {
        await this.prisma.contentRecommendation.create({
          data: {
            userId: request.userId,
            platform: request.platform as any,
            contentType: rec.contentType,
            topic: rec.topic,
            style: rec.style,
            frequency: rec.frequency,
            bestTimes: rec.bestTimes,
            trendingTopics: rec.trendingTopics,
            hashtagSuggestions: rec.hashtagSuggestions,
            contentIdeas: rec.contentIdeas,
            confidence: rec.confidence,
            reasoning: rec.reasoning,
          },
        });
      }

      return recommendations;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate recommendations: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate AI-powered recommendations
   */
  private async generateRecommendationsWithAI(
    request: ContentRecommendationRequest,
    contentAnalysis: any,
    engagementData: any,
    trendingTopics: any[],
  ): Promise<PersonalizedRecommendation[]> {
    if (!this.openai) {
      return this.generateMockRecommendations(request);
    }

    try {
      const prompt = `
        Generate personalized content recommendations for a ${request.platform} creator.
        
        User Profile:
        - Platform: ${request.platform}
        - Followers: ${request.currentFollowers || 'Unknown'}
        - Target Audience: ${request.targetAudience || 'General'}
        - Goals: ${request.goals?.join(', ') || 'Engagement & Growth'}
        
        Historical Performance:
        - Top performing content type: ${contentAnalysis.topContentType || 'Mixed'}
        - Avg engagement rate: ${engagementData.avgEngagementRate || 'N/A'}%
        - Best posting times: ${engagementData.bestTimes?.join(', ') || 'Not enough data'}
        - Content themes: ${contentAnalysis.themes?.join(', ') || 'Various'}
        
        Current Trending Topics:
        ${trendingTopics.map(t => `- ${t.topic} (${t.volume} mentions, ${t.growthRate}% growth)`).join('\n')}
        
        Generate 3-5 specific content recommendations with:
        1. Content type (post/story/reel/video/carousel)
        2. Topic/theme
        3. Content style (professional/casual/humorous/educational/inspirational)
        4. Posting frequency (daily/3x_week/weekly/bi_weekly)
        5. 3-5 specific content ideas for this theme
        6. 5-8 hashtag suggestions
        7. Best posting times (day and time)
        8. Reasoning for recommendation
        
        Format as JSON array:
        [
          {
            "contentType": "string",
            "topic": "string",
            "style": "string",
            "frequency": "string",
            "contentIdeas": [
              {
                "idea": "specific content idea",
                "format": "how to execute",
                "estimatedEngagement": 75,
                "difficulty": "easy|medium|hard"
              }
            ],
            "hashtagSuggestions": ["hashtag1", "hashtag2"],
            "bestTimes": [
              {"day": "Monday", "time": "10:00", "score": 85}
            ],
            "reasoning": "why this recommendation",
            "confidence": 85
          }
        ]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No recommendations generated');

      const recommendations = JSON.parse(content);
      
      return recommendations.map((rec: any) => ({
        ...rec,
        trendingTopics: trendingTopics.slice(0, 5).map(t => t.topic),
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI recommendation generation failed, using mock data: ${msg}`);
      return this.generateMockRecommendations(request);
    }
  }

  /**
   * Analyze user's content history
   */
  private async analyzeUserContent(userId: string, platform: string): Promise<any> {
    const posts = await this.prisma.socialPost.findMany({
      where: {
        userId,
        platform: platform as any,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (posts.length === 0) {
      return {
        topContentType: null,
        themes: [],
        avgPostLength: 0,
        hashtagUsage: 0,
      };
    }

    // Analyze content patterns
    const contentTypes = new Map<string, number>();
    const themes = new Set<string>();
    let totalLength = 0;
    let totalHashtags = 0;

    posts.forEach(post => {
      // Count content types (simplified - would need more logic)
      const type = post.content.includes('http') ? 'link' : 'text';
      contentTypes.set(type, (contentTypes.get(type) || 0) + 1);

      // Extract themes from content
      const words = post.content.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 5 && !this.isCommonWord(word)) {
          themes.add(word);
        }
      });

      totalLength += post.content.length;
      totalHashtags += (post.hashtags.match(/#/g) || []).length;
    });

    const topContentType = Array.from(contentTypes.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'text';

    return {
      topContentType,
      themes: Array.from(themes).slice(0, 10),
      avgPostLength: Math.floor(totalLength / posts.length),
      avgHashtagUsage: Math.floor(totalHashtags / posts.length),
      postCount: posts.length,
    };
  }

  /**
   * Get engagement analytics for user
   */
  private async getEngagementAnalytics(userId: string, platform: string): Promise<any> {
    const analytics = await this.prisma.engagementAnalytics.findMany({
      where: {
        userId,
        platform: platform as any,
        date: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      orderBy: { date: 'desc' },
    });

    if (analytics.length === 0) {
      return {
        avgEngagementRate: 0,
        bestTimes: [],
        topPerformingTypes: [],
      };
    }

    const totalEngagementRate = analytics.reduce((sum, a) => sum + (a.engagementRate || 0), 0);
    const avgEngagementRate = totalEngagementRate / analytics.length;

    // Extract best posting times from analytics
    const bestTimes = analytics
      .filter(a => a.bestPostingTimes)
      .flatMap(a => a.bestPostingTimes as any[])
      .slice(0, 5);

    return {
      avgEngagementRate: avgEngagementRate.toFixed(2),
      bestTimes: bestTimes.length > 0 ? bestTimes : ['Tuesday 10:00', 'Thursday 14:00', 'Friday 11:00'],
      followers: analytics[0]?.followers || 0,
      growth: this.calculateGrowth(analytics),
    };
  }

  /**
   * Get relevant trending topics for user
   */
  private async getRelevantTrends(userId: string, platform: string): Promise<any[]> {
    const trends = await this.prisma.trendingTopic.findMany({
      where: {
        platform: platform as any,
        expiresAt: {
          gte: new Date(),
        },
      },
      orderBy: { relevanceScore: 'desc' },
      take: 10,
    });

    return trends;
  }

  /**
   * Generate content calendar
   */
  async generateContentCalendar(
    userId: string,
    platform: string,
    month?: Date,
  ): Promise<ContentCalendar> {
    try {
      const targetMonth = month || new Date();
      
      // Get recommendations
      const recommendations = await this.getPersonalizedRecommendations({
        userId,
        platform,
      });

      // Generate calendar
      const calendar: ContentCalendar = {
        userId,
        platform,
        month: targetMonth.toISOString().slice(0, 7),
        recommendations: [],
      };

      // Calculate posting schedule based on recommendations
      const postingSchedule = this.calculatePostingSchedule(recommendations);

      // Fill calendar with content recommendations
      const daysInMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
      
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
        const daySchedule = postingSchedule.find(s => s.dayOfWeek === date.getDay());

        if (daySchedule) {
          recommendations.forEach(rec => {
            calendar.recommendations.push({
              date,
              contentType: rec.contentType,
              topic: rec.topic,
              hashtags: rec.hashtagSuggestions.slice(0, 5),
              bestTime: rec.bestTimes[0]?.time || '10:00',
              priority: this.calculatePriority(rec, day),
            });
          });
        }
      }

      return calendar;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate content calendar: ${msg}`);
      throw error;
    }
  }

  /**
   * Auto-generate weekly content recommendations
   */
  @Cron(CronExpression.EVERY_WEEK)
  async autoGenerateWeeklyRecommendations(): Promise<void> {
    try {
      this.logger.log('Generating weekly content recommendations...');

      // Get active users with social media accounts
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          socialMediaAccounts: {
            some: {
              isActive: true,
            },
          },
        },
        include: {
          socialMediaAccounts: true,
        },
        take: 100, // Process in batches
      });

      for (const user of users) {
        for (const account of user.socialMediaAccounts) {
          try {
            await this.getPersonalizedRecommendations({
              userId: user.id,
              platform: account.platform,
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to generate recommendations for user ${user.id}: ${msg}`);
          }
        }
      }

      this.logger.log(`Generated recommendations for ${users.length} users`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-generate recommendations failed: ${msg}`);
    }
  }

  /**
   * Helper methods
   */
  private isCommonWord(word: string): boolean {
    const commonWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'your', 'about', 'more', 'been', 'like', 'make', 'just', 'what', 'when', 'where'];
    return commonWords.includes(word.toLowerCase());
  }

  private calculateGrowth(analytics: any[]): number {
    if (analytics.length < 2) return 0;
    
    const oldest = analytics[analytics.length - 1];
    const newest = analytics[0];
    
    const oldFollowers = oldest.followers || 0;
    const newFollowers = newest.followers || 0;
    
    if (oldFollowers === 0) return 0;
    
    return ((newFollowers - oldFollowers) / oldFollowers) * 100;
  }

  private calculatePostingSchedule(recommendations: PersonalizedRecommendation[]): any[] {
    const schedule = [];
    const frequencies = recommendations.map(r => r.frequency);
    
    // Determine optimal days based on frequency
    if (frequencies.includes('daily')) {
      for (let i = 0; i < 7; i++) {
        schedule.push({ dayOfWeek: i, posts: 1 });
      }
    } else if (frequencies.includes('3x_week')) {
      [1, 3, 5].forEach(day => {
        schedule.push({ dayOfWeek: day, posts: 1 });
      });
    } else {
      [2, 4].forEach(day => {
        schedule.push({ dayOfWeek: day, posts: 1 });
      });
    }

    return schedule;
  }

  private calculatePriority(rec: PersonalizedRecommendation, day: number): 'high' | 'medium' | 'low' {
    // High priority for high-confidence recommendations on weekdays
    if (rec.confidence > 80 && day >= 1 && day <= 5) {
      return 'high';
    }
    // Medium priority for medium confidence or weekends
    if (rec.confidence > 60 || day === 0 || day === 6) {
      return 'medium';
    }
    return 'low';
  }

  private generateMockRecommendations(request: ContentRecommendationRequest): PersonalizedRecommendation[] {
    const platformRecommendations: Record<string, any[]> = {
      INSTAGRAM: [
        {
          contentType: 'reel',
          topic: 'Behind-the-scenes content',
          style: 'casual',
          frequency: '3x_week',
        },
        {
          contentType: 'carousel',
          topic: 'Educational tips and tricks',
          style: 'professional',
          frequency: 'weekly',
        },
      ],
      TIKTOK: [
        {
          contentType: 'video',
          topic: 'Trending challenges and sounds',
          style: 'humorous',
          frequency: 'daily',
        },
        {
          contentType: 'video',
          topic: 'Quick tutorials',
          style: 'educational',
          frequency: '3x_week',
        },
      ],
      LINKEDIN: [
        {
          contentType: 'post',
          topic: 'Industry insights and analysis',
          style: 'professional',
          frequency: '3x_week',
        },
        {
          contentType: 'post',
          topic: 'Personal growth stories',
          style: 'inspirational',
          frequency: 'weekly',
        },
      ],
      TWITTER: [
        {
          contentType: 'post',
          topic: 'Hot takes and opinions',
          style: 'casual',
          frequency: 'daily',
        },
        {
          contentType: 'post',
          topic: 'Industry news commentary',
          style: 'professional',
          frequency: '3x_week',
        },
      ],
    };

    const recs = platformRecommendations[request.platform] || platformRecommendations.INSTAGRAM;

    return recs.map(rec => ({
      ...rec,
      bestTimes: [
        { day: 'Tuesday', time: '10:00', score: 85 },
        { day: 'Thursday', time: '14:00', score: 82 },
        { day: 'Friday', time: '11:00', score: 80 },
      ],
      trendingTopics: ['AI productivity', 'Remote work', 'Digital transformation'],
      hashtagSuggestions: ['#socialmedia', '#contentcreator', '#trending', '#viral', '#growth'],
      contentIdeas: [
        {
          idea: `Share a day in the life focusing on ${rec.topic}`,
          format: 'Video or photo series',
          estimatedEngagement: 75,
          difficulty: 'easy' as const,
        },
        {
          idea: `Create a tutorial about ${rec.topic}`,
          format: 'Step-by-step guide',
          estimatedEngagement: 82,
          difficulty: 'medium' as const,
        },
        {
          idea: `Ask audience questions about ${rec.topic}`,
          format: 'Interactive poll or Q&A',
          estimatedEngagement: 88,
          difficulty: 'easy' as const,
        },
      ],
      confidence: 78,
      reasoning: `Based on ${request.platform} best practices and current engagement patterns`,
    }));
  }
}
