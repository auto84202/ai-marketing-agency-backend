import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAI } from 'openai';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface TrendingTopic {
  platform: string;
  topic: string;
  hashtag?: string;
  description: string;
  volume: number;
  growthRate: number;
  category: string;
  relatedTopics: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  peakTime?: Date;
  expiresAt?: Date;
  relevanceScore: number;
  contentSuggestions: string[];
}

export interface PlatformTrends {
  platform: string;
  trends: TrendingTopic[];
  lastUpdated: Date;
  nextUpdate: Date;
}

export interface TrendAnalysis {
  trends: PlatformTrends[];
  recommendations: string[];
  opportunities: Array<{
    topic: string;
    platform: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

@Injectable()
export class TrendAnalysisService {
  private readonly logger = new Logger(TrendAnalysisService.name);
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
   * Scan multiple platforms for trending topics
   */
  async scanTrendingTopics(
    platforms: string[] = ['TIKTOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER'],
  ): Promise<TrendAnalysis> {
    try {
      this.logger.log(`Scanning trending topics across ${platforms.length} platforms`);

      const platformTrends: PlatformTrends[] = [];

      for (const platform of platforms) {
        const trends = await this.getPlatformTrends(platform);
        platformTrends.push({
          platform,
          trends,
          lastUpdated: new Date(),
          nextUpdate: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        });
      }

      // Generate recommendations based on trends
      const recommendations = await this.generateTrendRecommendations(platformTrends);
      
      // Identify opportunities
      const opportunities = this.identifyOpportunities(platformTrends);

      return {
        trends: platformTrends,
        recommendations,
        opportunities,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to scan trending topics: ${msg}`);
      throw error;
    }
  }

  /**
   * Get trending topics for specific platform
   */
  async getPlatformTrends(platform: string): Promise<TrendingTopic[]> {
    try {
      // In production, this would integrate with platform APIs
      // For now, we'll generate intelligent mock data based on AI and current events
      
      const trends = await this.fetchTrendsFromDatabase(platform);
      
      if (trends.length > 0) {
        return trends;
      }

      // Generate fresh trends using AI
      const generatedTrends = await this.generateTrendsWithAI(platform);
      
      // Save to database
      await this.saveTrendsToDatabase(generatedTrends);

      return generatedTrends;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get ${platform} trends: ${msg}`);
      return [];
    }
  }

  /**
   * Generate trends using AI
   */
  private async generateTrendsWithAI(platform: string): Promise<TrendingTopic[]> {
    if (!this.openai) {
      return this.generateMockTrends(platform);
    }

    try {
      const prompt = `
        Generate 10 realistic trending topics for ${platform} right now.
        Consider current events, seasonal trends, and platform-specific content styles.
        
        For each trend, provide:
        - topic: Clear description
        - hashtag: Main hashtag (if applicable)
        - description: Why it's trending
        - category: Content category (tech, lifestyle, business, entertainment, etc.)
        - volume: Estimated posts/mentions (number)
        - growthRate: Growth percentage
        - sentiment: positive/negative/neutral
        - relatedTopics: Array of 3-5 related topics
        
        Format as JSON array:
        [
          {
            "topic": "string",
            "hashtag": "string",
            "description": "string",
            "category": "string",
            "volume": number,
            "growthRate": number,
            "sentiment": "positive|negative|neutral",
            "relatedTopics": ["string"]
          }
        ]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No trends generated');

      const trends = JSON.parse(content);
      
      return trends.map((trend: any) => ({
        platform,
        topic: trend.topic,
        hashtag: trend.hashtag,
        description: trend.description,
        volume: trend.volume,
        growthRate: trend.growthRate,
        category: trend.category,
        relatedTopics: trend.relatedTopics,
        sentiment: trend.sentiment,
        peakTime: new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + (2 + Math.random() * 5) * 24 * 60 * 60 * 1000),
        relevanceScore: 60 + Math.random() * 40,
        contentSuggestions: this.generateContentSuggestions(trend.topic, platform),
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI trend generation failed, using mock data: ${msg}`);
      return this.generateMockTrends(platform);
    }
  }

  /**
   * Auto-update trends periodically
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoUpdateTrends(): Promise<void> {
    try {
      this.logger.log('Auto-updating trending topics...');

      const platforms = ['TIKTOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER'];
      
      for (const platform of platforms) {
        try {
          // Delete expired trends
          await this.prisma.trendingTopic.deleteMany({
            where: {
              platform: platform as any,
              expiresAt: {
                lte: new Date(),
              },
            },
          });

          // Generate new trends
          const trends = await this.generateTrendsWithAI(platform);
          await this.saveTrendsToDatabase(trends);
          
          this.logger.log(`Updated ${trends.length} trends for ${platform}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to update ${platform} trends: ${msg}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-update trends failed: ${msg}`);
    }
  }

  /**
   * Get personalized trending topics for user
   */
  async getPersonalizedTrends(
    userId: string,
    platforms: string[],
  ): Promise<TrendingTopic[]> {
    try {
      // Get user's content history and preferences
      const userContent = await this.prisma.socialPost.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // Extract user's topics of interest
      const userTopics = this.extractUserTopics(userContent);

      // Get all trends for specified platforms
      const allTrends = await this.prisma.trendingTopic.findMany({
        where: {
          platform: { in: platforms as any[] },
          expiresAt: {
            gte: new Date(),
          },
        },
        orderBy: { growthRate: 'desc' },
      });

      // Calculate relevance scores based on user's interests
      const scoredTrends = allTrends.map(trend => ({
        ...trend,
        relevanceScore: this.calculateRelevanceScore(trend, userTopics),
      }));

      // Sort by relevance and return top trends
      return scoredTrends
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 20)
        .map(trend => ({
          platform: trend.platform,
          topic: trend.topic,
          hashtag: trend.hashtag || undefined,
          description: trend.description || '',
          volume: trend.volume || 0,
          growthRate: trend.growthRate || 0,
          category: trend.category || '',
          relatedTopics: (trend.relatedTopics as any) || [],
          sentiment: (trend.sentiment as any) || 'neutral',
          peakTime: trend.peakTime || undefined,
          expiresAt: trend.expiresAt || undefined,
          relevanceScore: trend.relevanceScore || 0,
          contentSuggestions: this.generateContentSuggestions(trend.topic, trend.platform),
        }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get personalized trends: ${msg}`);
      throw error;
    }
  }

  /**
   * Analyze trend and provide content recommendations
   */
  async analyzeTrend(trendId: string): Promise<any> {
    try {
      const trend = await this.prisma.trendingTopic.findUnique({
        where: { id: trendId },
      });

      if (!trend) {
        throw new Error('Trend not found');
      }

      // Generate detailed analysis using AI
      const analysis = await this.generateTrendAnalysis(trend);
      
      return {
        trend,
        analysis,
        contentIdeas: analysis.contentIdeas,
        hashtagStrategy: analysis.hashtagStrategy,
        targetAudience: analysis.targetAudience,
        competitionLevel: analysis.competitionLevel,
        recommendations: analysis.recommendations,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to analyze trend: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate detailed trend analysis with AI
   */
  private async generateTrendAnalysis(trend: any): Promise<any> {
    if (!this.openai) {
      return this.generateMockAnalysis(trend);
    }

    try {
      const prompt = `
        Analyze this trending topic for content creators:
        
        Topic: ${trend.topic}
        Platform: ${trend.platform}
        Description: ${trend.description}
        Volume: ${trend.volume} mentions
        Growth Rate: ${trend.growthRate}%
        Category: ${trend.category}
        
        Provide:
        1. 5 specific content ideas that leverage this trend
        2. Hashtag strategy (mix of trending and niche hashtags)
        3. Target audience profile
        4. Competition level (low/medium/high) and why
        5. 3 actionable recommendations for content creators
        
        Format as JSON:
        {
          "contentIdeas": ["idea1", "idea2", ...],
          "hashtagStrategy": {
            "trending": ["hashtag1", "hashtag2"],
            "niche": ["hashtag3", "hashtag4"],
            "branded": ["hashtag5"]
          },
          "targetAudience": {
            "demographics": "description",
            "interests": ["interest1", "interest2"],
            "painPoints": ["pain1", "pain2"]
          },
          "competitionLevel": "low|medium|high",
          "competitionReason": "explanation",
          "recommendations": ["rec1", "rec2", "rec3"]
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No analysis generated');

      return JSON.parse(content);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI analysis failed, using mock data: ${msg}`);
      return this.generateMockAnalysis(trend);
    }
  }

  /**
   * Generate trend recommendations
   */
  private async generateTrendRecommendations(platformTrends: PlatformTrends[]): Promise<string[]> {
    const recommendations: string[] = [];

    // Find cross-platform trends
    const topicCounts = new Map<string, number>();
    platformTrends.forEach(pt => {
      pt.trends.forEach(trend => {
        const count = topicCounts.get(trend.topic) || 0;
        topicCounts.set(trend.topic, count + 1);
      });
    });

    const crossPlatformTrends = Array.from(topicCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([topic, _]) => topic);

    if (crossPlatformTrends.length > 0) {
      recommendations.push(
        `Cross-platform trending: ${crossPlatformTrends.slice(0, 3).join(', ')} - Create content for multiple platforms`
      );
    }

    // High growth trends
    const highGrowthTrends = platformTrends.flatMap(pt =>
      pt.trends.filter(t => t.growthRate > 100)
    );

    if (highGrowthTrends.length > 0) {
      recommendations.push(
        `Rapidly growing: ${highGrowthTrends.slice(0, 2).map(t => t.topic).join(', ')} - Act fast to capitalize`
      );
    }

    // Platform-specific recommendations
    platformTrends.forEach(pt => {
      const topTrend = pt.trends[0];
      if (topTrend) {
        recommendations.push(
          `${pt.platform}: Focus on "${topTrend.topic}" (${topTrend.volume.toLocaleString()} mentions)`
        );
      }
    });

    return recommendations;
  }

  /**
   * Identify content opportunities
   */
  private identifyOpportunities(platformTrends: PlatformTrends[]): any[] {
    const opportunities: any[] = [];

    platformTrends.forEach(pt => {
      pt.trends.forEach(trend => {
        let priority: 'high' | 'medium' | 'low' = 'medium';
        let reason = '';

        // High priority: High growth + high volume
        if (trend.growthRate > 150 && trend.volume > 50000) {
          priority = 'high';
          reason = `Viral potential: ${trend.growthRate}% growth with ${(trend.volume / 1000).toFixed(0)}k mentions`;
        }
        // Medium priority: Good relevance
        else if (trend.relevanceScore > 75) {
          priority = 'medium';
          reason = `High relevance to your content (${trend.relevanceScore.toFixed(0)}% match)`;
        }
        // Low priority: Stable trends
        else if (trend.growthRate < 50 && trend.volume > 100000) {
          priority = 'low';
          reason = `Established trend with consistent engagement`;
        }

        if (reason) {
          opportunities.push({
            topic: trend.topic,
            platform: pt.platform,
            reason,
            priority,
            hashtag: trend.hashtag,
            contentSuggestions: trend.contentSuggestions?.slice(0, 3) || [],
          });
        }
      });
    });

    return opportunities.sort((a, b) => {
      const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });
  }

  /**
   * Helper methods
   */
  private async fetchTrendsFromDatabase(platform: string): Promise<TrendingTopic[]> {
    const trends = await this.prisma.trendingTopic.findMany({
      where: {
        platform: platform as any,
        expiresAt: {
          gte: new Date(),
        },
      },
      orderBy: { growthRate: 'desc' },
      take: 20,
    });

    return trends.map(trend => ({
      platform: trend.platform,
      topic: trend.topic,
      hashtag: trend.hashtag || undefined,
      description: trend.description || '',
      volume: trend.volume || 0,
      growthRate: trend.growthRate || 0,
      category: trend.category || '',
      relatedTopics: (trend.relatedTopics as any) || [],
      sentiment: (trend.sentiment as any) || 'neutral',
      peakTime: trend.peakTime || undefined,
      expiresAt: trend.expiresAt || undefined,
      relevanceScore: trend.relevanceScore || 0,
      contentSuggestions: this.generateContentSuggestions(trend.topic, platform),
    }));
  }

  private async saveTrendsToDatabase(trends: TrendingTopic[]): Promise<void> {
    for (const trend of trends) {
      try {
        await this.prisma.trendingTopic.create({
          data: {
            platform: trend.platform as any,
            topic: trend.topic,
            hashtag: trend.hashtag,
            description: trend.description,
            volume: trend.volume,
            growthRate: trend.growthRate,
            category: trend.category,
            relatedTopics: trend.relatedTopics,
            sentiment: trend.sentiment,
            peakTime: trend.peakTime,
            expiresAt: trend.expiresAt,
            relevanceScore: trend.relevanceScore,
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to save trend ${trend.topic}: ${msg}`);
      }
    }
  }

  private generateContentSuggestions(topic: string, platform: string): string[] {
    const suggestions = [
      `Share your perspective on ${topic}`,
      `Create a tutorial about ${topic}`,
      `Share tips related to ${topic}`,
      `Ask your audience about their experience with ${topic}`,
      `Create a behind-the-scenes look at ${topic}`,
    ];

    // Platform-specific adjustments
    if (platform === 'TIKTOK') {
      return [
        `Make a trending sound video about ${topic}`,
        `Create a quick tip video on ${topic}`,
        `Do a challenge related to ${topic}`,
      ];
    } else if (platform === 'LINKEDIN') {
      return [
        `Share professional insights on ${topic}`,
        `Write a thought leadership piece about ${topic}`,
        `Share case studies related to ${topic}`,
      ];
    }

    return suggestions.slice(0, 3);
  }

  private extractUserTopics(posts: any[]): string[] {
    const topics = new Set<string>();
    
    posts.forEach(post => {
      // Extract keywords from content
      const words = post.content.toLowerCase().split(/\s+/);
      words.forEach((word: string) => {
        if (word.length > 4 && !this.isCommonWord(word)) {
          topics.add(word);
        }
      });

      // Extract from hashtags
      const hashtags = post.hashtags.split(' ');
      hashtags.forEach((tag: string) => {
        if (tag.startsWith('#')) {
          topics.add(tag.slice(1).toLowerCase());
        }
      });
    });

    return Array.from(topics);
  }

  private calculateRelevanceScore(trend: any, userTopics: string[]): number {
    let score = trend.relevanceScore || 50;

    const trendWords = trend.topic.toLowerCase().split(/\s+/);
    const trendHashtag = trend.hashtag?.toLowerCase().replace('#', '') || '';

    // Check overlap with user topics
    const matches = trendWords.filter((word: string) =>
      userTopics.some(topic => topic.includes(word) || word.includes(topic))
    );

    score += matches.length * 10;

    // Bonus for hashtag match
    if (trendHashtag && userTopics.includes(trendHashtag)) {
      score += 20;
    }

    // Bonus for same category
    if (trend.category && this.isRelevantCategory(trend.category, userTopics)) {
      score += 15;
    }

    return Math.min(100, score);
  }

  private isCommonWord(word: string): boolean {
    const commonWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'your', 'about', 'more', 'been', 'like', 'make', 'just'];
    return commonWords.includes(word);
  }

  private isRelevantCategory(category: string, userTopics: string[]): boolean {
    return userTopics.some(topic => 
      category.toLowerCase().includes(topic) || topic.includes(category.toLowerCase())
    );
  }

  private generateMockTrends(platform: string): TrendingTopic[] {
    const mockTopics: Record<string, any[]> = {
      TIKTOK: [
        { topic: 'AI productivity hacks', category: 'tech', volume: 250000, growth: 180 },
        { topic: 'Morning routine 2024', category: 'lifestyle', volume: 180000, growth: 150 },
        { topic: 'Small business tips', category: 'business', volume: 120000, growth: 95 },
      ],
      INSTAGRAM: [
        { topic: 'Sustainable living', category: 'lifestyle', volume: 200000, growth: 120 },
        { topic: 'Travel photography', category: 'travel', volume: 350000, growth: 85 },
        { topic: 'Fitness transformation', category: 'health', volume: 280000, growth: 110 },
      ],
      LINKEDIN: [
        { topic: 'Remote work strategies', category: 'business', volume: 150000, growth: 90 },
        { topic: 'AI in business', category: 'tech', volume: 180000, growth: 140 },
        { topic: 'Leadership development', category: 'professional', volume: 120000, growth: 75 },
      ],
      TWITTER: [
        { topic: 'Tech innovation', category: 'tech', volume: 300000, growth: 160 },
        { topic: 'Marketing trends', category: 'marketing', volume: 200000, growth: 100 },
        { topic: 'Startup life', category: 'business', volume: 150000, growth: 85 },
      ],
    };

    const topics = mockTopics[platform] || mockTopics.INSTAGRAM;

    return topics.map((topic: any, index: number) => ({
      platform,
      topic: topic.topic,
      hashtag: `#${topic.topic.replace(/\s+/g, '')}`,
      description: `${topic.topic} is trending due to increased interest in ${topic.category}`,
      volume: topic.volume,
      growthRate: topic.growth,
      category: topic.category,
      relatedTopics: [`${topic.category} tips`, `${topic.category} guide`, `${topic.category} 2024`],
      sentiment: 'positive' as const,
      peakTime: new Date(Date.now() + (index * 3) * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + (3 + index) * 24 * 60 * 60 * 1000),
      relevanceScore: 70 + Math.random() * 30,
      contentSuggestions: this.generateContentSuggestions(topic.topic, platform),
    }));
  }

  private generateMockAnalysis(trend: any): any {
    return {
      contentIdeas: [
        `Create a how-to guide on ${trend.topic}`,
        `Share your personal story related to ${trend.topic}`,
        `Interview an expert about ${trend.topic}`,
        `Create a comparison post featuring ${trend.topic}`,
        `Make a predictions post about the future of ${trend.topic}`,
      ],
      hashtagStrategy: {
        trending: [trend.hashtag, `#${trend.category}`, '#trending'],
        niche: [`#${trend.category}tips`, `#${trend.category}community`],
        branded: ['#yourbranding'],
      },
      targetAudience: {
        demographics: `${trend.category} enthusiasts aged 25-45`,
        interests: [trend.category, 'innovation', 'trends'],
        painPoints: ['staying current', 'finding relevant content', 'engagement'],
      },
      competitionLevel: 'medium',
      competitionReason: `Moderate competition with ${trend.volume} posts, but growing rapidly`,
      recommendations: [
        'Post within the next 24-48 hours while trend is hot',
        'Use a mix of trending and niche hashtags',
        'Engage with other posts in this trend to boost visibility',
      ],
    };
  }
}
