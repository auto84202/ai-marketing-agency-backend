import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAI } from 'openai';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface CommentAnalysis {
  commentId: string;
  content: string;
  author: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'URGENT';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  needsResponse: boolean;
  suggestedResponses: string[];
  responseStrategy: string;
  keywords: string[];
  intent: string; // 'question', 'complaint', 'praise', 'feedback', 'spam'
}

export interface ResponseSuggestion {
  response: string;
  tone: 'professional' | 'friendly' | 'empathetic' | 'enthusiastic';
  includesEmoji: boolean;
  includesCallToAction: boolean;
  confidence: number;
}

export interface EngagementInsights {
  postId: string;
  totalComments: number;
  commentsByType: Record<string, number>;
  averageResponseTime: number;
  responseRate: number;
  topQuestions: string[];
  commonThemes: string[];
  sentimentBreakdown: Record<string, number>;
  actionableInsights: string[];
}

@Injectable()
export class CommentMonitoringService {
  private readonly logger = new Logger(CommentMonitoringService.name);
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
   * Monitor comments and suggest responses
   */
  async monitorComments(postId: string): Promise<CommentAnalysis[]> {
    try {
      this.logger.log(`Monitoring comments for post: ${postId}`);

      const post = await this.prisma.socialPost.findUnique({
        where: { id: postId },
        include: {
          comments: {
            where: { isRead: false },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!post) {
        throw new Error('Post not found');
      }

      const analyses: CommentAnalysis[] = [];

      for (const comment of post.comments) {
        try {
          const analysis = await this.analyzeComment(comment, post.platform);
          analyses.push(analysis);

          // Update comment with analysis
          await this.prisma.socialComment.update({
            where: { id: comment.id },
            data: {
              sentiment: analysis.sentiment,
              priority: analysis.priority,
              needsResponse: analysis.needsResponse,
              suggestedResponses: analysis.suggestedResponses,
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to analyze comment ${comment.id}: ${msg}`);
        }
      }

      return analyses;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to monitor comments: ${msg}`);
      throw error;
    }
  }

  /**
   * Analyze individual comment with AI
   */
  async analyzeComment(comment: any, platform: string): Promise<CommentAnalysis> {
    try {
      // Detect sentiment
      const sentiment = await this.detectSentiment(comment.content);
      
      // Determine priority
      const priority = this.calculatePriority(comment.content, sentiment);
      
      // Check if response needed
      const needsResponse = this.needsResponse(comment.content, sentiment);
      
      // Generate response suggestions
      const suggestedResponses = await this.generateResponseSuggestions(
        comment.content,
        sentiment,
        platform,
      );
      
      // Extract keywords and intent
      const keywords = this.extractKeywords(comment.content);
      const intent = this.detectIntent(comment.content);

      return {
        commentId: comment.id,
        content: comment.content,
        author: comment.authorName,
        sentiment,
        priority,
        needsResponse,
        suggestedResponses,
        responseStrategy: this.getResponseStrategy(sentiment, intent),
        keywords,
        intent,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to analyze comment: ${msg}`);
      throw error;
    }
  }

  /**
   * Detect sentiment using AI
   */
  private async detectSentiment(content: string): Promise<'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'URGENT'> {
    if (!this.openai) {
      return this.detectSentimentBasic(content);
    }

    try {
      const prompt = `
        Analyze the sentiment of this social media comment:
        "${content}"
        
        Classify as one of: POSITIVE, NEGATIVE, NEUTRAL, or URGENT
        
        URGENT should be used for:
        - Customer service issues requiring immediate attention
        - Complaints about products/services
        - Requests for help or support
        - Time-sensitive questions
        
        Respond with only the classification (one word).
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 10,
      });

      const sentiment = response.choices[0]?.message?.content?.trim().toUpperCase() || 'NEUTRAL';
      
      if (['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'URGENT'].includes(sentiment)) {
        return sentiment as any;
      }

      return 'NEUTRAL';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI sentiment detection failed, using basic method: ${msg}`);
      return this.detectSentimentBasic(content);
    }
  }

  /**
   * Basic sentiment detection (fallback)
   */
  private detectSentimentBasic(content: string): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'URGENT' {
    const lowerContent = content.toLowerCase();
    
    // Check for urgent keywords
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'help', 'problem', 'issue', 'broken', 'not working', 'error'];
    if (urgentKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'URGENT';
    }

    // Check for negative keywords
    const negativeKeywords = ['bad', 'terrible', 'worst', 'hate', 'awful', 'horrible', 'disappointed', 'angry', 'frustrated'];
    const negativeCount = negativeKeywords.filter(keyword => lowerContent.includes(keyword)).length;

    // Check for positive keywords
    const positiveKeywords = ['love', 'great', 'amazing', 'awesome', 'excellent', 'fantastic', 'best', 'wonderful', 'perfect'];
    const positiveCount = positiveKeywords.filter(keyword => lowerContent.includes(keyword)).length;

    if (negativeCount > positiveCount && negativeCount > 0) {
      return 'NEGATIVE';
    } else if (positiveCount > negativeCount && positiveCount > 0) {
      return 'POSITIVE';
    }

    return 'NEUTRAL';
  }

  /**
   * Generate response suggestions
   */
  private async generateResponseSuggestions(
    commentContent: string,
    sentiment: string,
    platform: string,
  ): Promise<string[]> {
    if (!this.openai) {
      return this.generateBasicResponses(commentContent, sentiment);
    }

    try {
      const prompt = `
        Generate 3 appropriate response suggestions for this ${platform} comment:
        Comment: "${commentContent}"
        Sentiment: ${sentiment}
        
        Requirements:
        - Keep responses natural and engaging
        - Match the tone to the sentiment (empathetic for negative, enthusiastic for positive)
        - Keep it concise (1-2 sentences)
        - Include emojis where appropriate for ${platform}
        - Encourage further engagement
        ${sentiment === 'NEGATIVE' || sentiment === 'URGENT' ? '- Show empathy and willingness to help' : ''}
        ${sentiment === 'POSITIVE' ? '- Express gratitude and reciprocate positivity' : ''}
        
        Format as JSON array of strings:
        ["response1", "response2", "response3"]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No responses generated');

      const suggestions = JSON.parse(content);
      return Array.isArray(suggestions) ? suggestions : [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI response generation failed, using basic responses: ${msg}`);
      return this.generateBasicResponses(commentContent, sentiment);
    }
  }

  /**
   * Basic response suggestions (fallback)
   */
  private generateBasicResponses(content: string, sentiment: string): string[] {
    const isQuestion = content.includes('?');

    switch (sentiment) {
      case 'POSITIVE':
        return [
          "Thank you so much! 🙏 We're glad you enjoyed it!",
          "We appreciate your support! 💙",
          "Thanks for the love! It means a lot to us! ❤️",
        ];

      case 'NEGATIVE':
        return [
          "We're sorry to hear that. Could you share more details so we can help? 🙏",
          "We apologize for your experience. Please DM us so we can make this right.",
          "Thank you for your feedback. We're working to improve and would love to discuss this further.",
        ];

      case 'URGENT':
        return [
          "We're here to help! Please send us a DM with more details and we'll assist you right away.",
          "Thanks for reaching out! We're looking into this now. Can you DM us more information?",
          "We take this seriously. Please contact us directly so we can resolve this immediately.",
        ];

      default:
        if (isQuestion) {
          return [
            "Great question! Let me get back to you with a detailed answer.",
            "Thanks for asking! Here's what I can share:",
            "That's a great point! Let me address that for you.",
          ];
        }
        return [
          "Thanks for your comment! 😊",
          "We appreciate you engaging with our content!",
          "Thank you for being part of our community! 💙",
        ];
    }
  }

  /**
   * Calculate comment priority
   */
  private calculatePriority(content: string, sentiment: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
    if (sentiment === 'URGENT') {
      return 'URGENT';
    }

    if (sentiment === 'NEGATIVE') {
      return 'HIGH';
    }

    const isQuestion = content.includes('?');
    const isLongComment = content.length > 200;
    const mentionsBrand = content.toLowerCase().includes('@');

    if (isQuestion || mentionsBrand) {
      return 'HIGH';
    }

    if (isLongComment) {
      return 'NORMAL';
    }

    return 'LOW';
  }

  /**
   * Determine if comment needs response
   */
  private needsResponse(content: string, sentiment: string): boolean {
    // Always respond to negative/urgent comments
    if (sentiment === 'NEGATIVE' || sentiment === 'URGENT') {
      return true;
    }

    // Respond to questions
    if (content.includes('?')) {
      return true;
    }

    // Respond to mentions
    if (content.toLowerCase().includes('@')) {
      return true;
    }

    // Respond to long, thoughtful comments
    if (content.length > 150) {
      return true;
    }

    return false;
  }

  /**
   * Extract keywords from comment
   */
  private extractKeywords(content: string): string[] {
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 4 && !this.isCommonWord(word));

    // Get unique keywords
    return Array.from(new Set(words)).slice(0, 5);
  }

  /**
   * Detect comment intent
   */
  private detectIntent(content: string): string {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('?')) {
      return 'question';
    }

    if (lowerContent.includes('love') || lowerContent.includes('great') || lowerContent.includes('amazing')) {
      return 'praise';
    }

    if (lowerContent.includes('problem') || lowerContent.includes('issue') || lowerContent.includes('not working')) {
      return 'complaint';
    }

    if (lowerContent.includes('suggest') || lowerContent.includes('could') || lowerContent.includes('should')) {
      return 'feedback';
    }

    if (lowerContent.includes('http') && lowerContent.split(/\s+/).length < 5) {
      return 'spam';
    }

    return 'general';
  }

  /**
   * Get response strategy
   */
  private getResponseStrategy(sentiment: string, intent: string): string {
    const strategies: Record<string, string> = {
      'URGENT-complaint': 'Immediate empathy and escalation to support',
      'NEGATIVE-complaint': 'Apologize, acknowledge, and offer solution',
      'POSITIVE-praise': 'Express gratitude and encourage continued engagement',
      'NEUTRAL-question': 'Provide helpful answer and ask follow-up question',
      'NEUTRAL-feedback': 'Thank them and explain how feedback will be used',
    };

    const key = `${sentiment}-${intent}`;
    return strategies[key] || 'Engage authentically and encourage conversation';
  }

  /**
   * Get engagement insights for post
   */
  async getEngagementInsights(postId: string): Promise<EngagementInsights> {
    try {
      const post = await this.prisma.socialPost.findUnique({
        where: { id: postId },
        include: {
          comments: true,
        },
      });

      if (!post) {
        throw new Error('Post not found');
      }

      const comments = post.comments;
      
      // Analyze comments
      const commentsByType: Record<string, number> = {};
      const sentimentBreakdown: Record<string, number> = {};
      const allKeywords: string[] = [];
      const questions: string[] = [];
      const respondedComments = comments.filter(c => c.respondedAt);

      for (const comment of comments) {
        // Count by intent
        const intent = this.detectIntent(comment.content);
        commentsByType[intent] = (commentsByType[intent] || 0) + 1;

        // Count by sentiment
        if (comment.sentiment) {
          sentimentBreakdown[comment.sentiment] = (sentimentBreakdown[comment.sentiment] || 0) + 1;
        }

        // Collect keywords
        allKeywords.push(...this.extractKeywords(comment.content));

        // Collect questions
        if (comment.content.includes('?')) {
          questions.push(comment.content);
        }
      }

      // Calculate metrics
      const averageResponseTime = this.calculateAverageResponseTime(respondedComments);
      const responseRate = comments.length > 0 ? (respondedComments.length / comments.length) * 100 : 0;
      
      // Get top keywords
      const keywordCounts = new Map<string, number>();
      allKeywords.forEach(keyword => {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      });
      const topKeywords = Array.from(keywordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword]) => keyword);

      // Generate actionable insights
      const actionableInsights = this.generateActionableInsights({
        totalComments: comments.length,
        commentsByType,
        sentimentBreakdown,
        responseRate,
        topKeywords,
      });

      return {
        postId,
        totalComments: comments.length,
        commentsByType,
        averageResponseTime,
        responseRate,
        topQuestions: questions.slice(0, 5),
        commonThemes: topKeywords,
        sentimentBreakdown,
        actionableInsights,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get engagement insights: ${msg}`);
      throw error;
    }
  }

  /**
   * Auto-monitor comments for all active posts
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoMonitorComments(): Promise<void> {
    try {
      this.logger.log('Auto-monitoring comments...');

      // Get posts from last 7 days with unread comments
      const posts = await this.prisma.socialPost.findMany({
        where: {
          status: 'PUBLISHED',
          postedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
          comments: {
            some: {
              isRead: false,
            },
          },
        },
        take: 20, // Process in batches
      });

      for (const post of posts) {
        try {
          await this.monitorComments(post.id);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to monitor comments for post ${post.id}: ${msg}`);
        }
      }

      this.logger.log(`Monitored comments for ${posts.length} posts`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-monitor comments failed: ${msg}`);
    }
  }

  /**
   * Helper methods
   */
  private isCommonWord(word: string): boolean {
    const commonWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'your', 'about', 'more', 'been', 'like', 'make', 'just', 'what', 'when', 'where', 'than', 'very', 'some', 'them', 'would', 'could', 'should'];
    return commonWords.includes(word.toLowerCase());
  }

  private calculateAverageResponseTime(comments: any[]): number {
    if (comments.length === 0) return 0;

    const totalMinutes = comments.reduce((sum, comment) => {
      const created = new Date(comment.createdAt).getTime();
      const responded = new Date(comment.respondedAt).getTime();
      const diffMinutes = (responded - created) / (1000 * 60);
      return sum + diffMinutes;
    }, 0);

    return Math.floor(totalMinutes / comments.length);
  }

  private generateActionableInsights(data: any): string[] {
    const insights: string[] = [];

    // Response rate insights
    if (data.responseRate < 50) {
      insights.push(`Low response rate (${data.responseRate.toFixed(0)}%) - Consider responding to more comments to boost engagement`);
    } else if (data.responseRate > 80) {
      insights.push(`Excellent response rate (${data.responseRate.toFixed(0)}%) - Keep up the great engagement!`);
    }

    // Sentiment insights
    const negative = data.sentimentBreakdown.NEGATIVE || 0;
    const positive = data.sentimentBreakdown.POSITIVE || 0;
    
    if (negative > positive) {
      insights.push('More negative comments than positive - Review content strategy and address concerns');
    } else if (positive > negative * 3) {
      insights.push('Overwhelmingly positive sentiment - Great content resonance with audience');
    }

    // Question insights
    const questions = data.commentsByType.question || 0;
    if (questions > data.totalComments * 0.3) {
      insights.push('Many questions - Consider creating FAQ content or follow-up posts addressing common queries');
    }

    // Spam insights
    const spam = data.commentsByType.spam || 0;
    if (spam > 5) {
      insights.push(`${spam} potential spam comments detected - Review and moderate`);
    }

    // Engagement opportunity
    if (data.totalComments > 50) {
      insights.push('High engagement - Perfect opportunity to deepen connections with active community members');
    }

    return insights;
  }
}
