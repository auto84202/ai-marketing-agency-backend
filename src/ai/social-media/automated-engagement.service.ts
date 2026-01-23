import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OpenAI } from 'openai';
import { FacebookService } from '../../integrations/social/facebook.service';
import { InstagramService } from '../../integrations/social/instagram.service';
import { TwitterService } from '../../integrations/social/twitter.service';
import { LinkedInService } from '../../integrations/social/linkedin.service';

export interface EngagementConfig {
  personality: 'professional' | 'friendly' | 'casual' | 'expert';
  responseStyle: 'direct' | 'conversational' | 'educational';
  maxResponseLength: number;
  includeCallToAction: boolean;
  customInstructions?: string;
}

export interface EngagementResult {
  matchId: string;
  platform: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  response?: string;
  responseId?: string;
  error?: string;
  timestamp: Date;
}

export interface EngagementAnalytics {
  totalEngagements: number;
  successfulEngagements: number;
  failedEngagements: number;
  skippedEngagements: number;
  averageResponseTime: number;
  engagementsByPlatform: { platform: string; count: number }[];
  sentimentImpact: number;
}

@Injectable()
export class AutomatedEngagementService {
  private readonly logger = new Logger(AutomatedEngagementService.name);
  private openai: OpenAI;
  private engagementQueue: Map<string, any[]> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly facebookService: FacebookService,
    private readonly instagramService: InstagramService,
    private readonly twitterService: TwitterService,
    private readonly linkedinService: LinkedInService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.openai = null as any;
    }
  }

  /**
   * Start automated engagement for a campaign
   */
  async startAutomatedEngagement(
    campaignId: string,
    config: EngagementConfig,
  ): Promise<{ started: boolean; message: string }> {
    try {
      const campaign = await this.prisma.keywordCampaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // Update campaign with engagement config
      await this.prisma.keywordCampaign.update({
        where: { id: campaignId },
        data: {
          engagementConfig: config as any,
          autoEngagementEnabled: true,
        },
      });

      // Start engaging with pending matches
      this.engagePendingMatches(campaignId).catch((error) => {
        this.logger.error(`Failed to engage pending matches: ${error.message}`);
      });

      return {
        started: true,
        message: 'Automated engagement started successfully',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start automated engagement: ${msg}`);
      throw error;
    }
  }

  /**
   * Stop automated engagement for a campaign
   */
  async stopAutomatedEngagement(campaignId: string): Promise<void> {
    await this.prisma.keywordCampaign.update({
      where: { id: campaignId },
      data: { autoEngagementEnabled: false },
    });

    this.engagementQueue.delete(campaignId);
  }

  /**
   * Engage with pending matches (runs periodically)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async engageWithPendingMatches(): Promise<void> {
    try {
      this.logger.log('Starting automated engagement with pending matches');

      const campaigns = await this.prisma.keywordCampaign.findMany({
        where: {
          isActive: true,
          autoEngagementEnabled: true,
        },
      });

      for (const campaign of campaigns) {
        await this.engagePendingMatches(campaign.id).catch((error) => {
          this.logger.error(`Failed to engage matches for campaign ${campaign.id}: ${error.message}`);
        });
      }

      this.logger.log('Completed automated engagement cycle');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to engage with pending matches: ${msg}`);
    }
  }

  /**
   * Engage with pending matches for a specific campaign
   */
  async engagePendingMatches(campaignId: string): Promise<EngagementResult[]> {
    try {
      const campaign = await this.prisma.keywordCampaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || !campaign.autoEngagementEnabled) {
        return [];
      }

      // Get pending matches (limit to 20 per cycle to avoid rate limits)
      const pendingMatches = await this.prisma.keywordMatch.findMany({
        where: {
          campaignId,
          engagementStatus: 'PENDING',
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
      });

      if (pendingMatches.length === 0) {
        return [];
      }

      this.logger.log(`Engaging with ${pendingMatches.length} pending matches for campaign ${campaignId}`);

      const config = (campaign.engagementConfig as any) || this.getDefaultEngagementConfig();
      const results: EngagementResult[] = [];

      for (const match of pendingMatches) {
        const result = await this.engageWithMatch(match, campaign, config).catch((error) => {
          this.logger.error(`Failed to engage with match ${match.id}: ${error.message}`);
          return {
            matchId: match.id,
            platform: match.platform,
            status: 'FAILED' as const,
            error: error.message,
            timestamp: new Date(),
          };
        });

        results.push(result);

        // Add delay between engagements to avoid rate limits
        await this.delay(2000);
      }

      return results;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to engage pending matches: ${msg}`);
      throw error;
    }
  }

  /**
   * Engage with a specific match
   */
  private async engageWithMatch(
    match: any,
    campaign: any,
    config: EngagementConfig,
  ): Promise<EngagementResult> {
    try {
      this.logger.log(`Engaging with match ${match.id} on ${match.platform}`);

      // Analyze the content and sentiment
      const sentiment = await this.analyzeSentiment(match.content);

      // Skip if sentiment is very negative or spam-like
      if (sentiment < -0.7) {
        await this.prisma.keywordMatch.update({
          where: { id: match.id },
          data: {
            engagementStatus: 'SKIPPED',
            engagementNote: 'Skipped due to negative sentiment',
          },
        });

        return {
          matchId: match.id,
          platform: match.platform,
          status: 'SKIPPED',
          timestamp: new Date(),
        };
      }

      // Generate AI response
      const response = await this.generateResponse(
        match.content,
        campaign.businessName,
        campaign.businessDescription,
        match.matchedKeywords,
        config,
      );

      // Post the response to the platform
      const responseId = await this.postResponse(
        match.platform,
        match.postId,
        match.commentId,
        response,
        campaign.userId,
      );

      // Update match status
      await this.prisma.keywordMatch.update({
        where: { id: match.id },
        data: {
          engagementStatus: 'ENGAGED',
          engagementResponse: response,
          engagementResponseId: responseId,
          engagedAt: new Date(),
        },
      });

      // Log engagement
      await this.prisma.engagementLog.create({
        data: {
          campaignId: campaign.id,
          matchId: match.id,
          platform: match.platform,
          response,
          responseId,
          status: 'SUCCESS',
        },
      });

      return {
        matchId: match.id,
        platform: match.platform,
        status: 'SUCCESS',
        response,
        responseId,
        timestamp: new Date(),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to engage with match ${match.id}: ${msg}`);

      // Update match status to failed
      await this.prisma.keywordMatch.update({
        where: { id: match.id },
        data: {
          engagementStatus: 'FAILED',
          engagementNote: msg,
        },
      });

      return {
        matchId: match.id,
        platform: match.platform,
        status: 'FAILED',
        error: msg,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Generate AI-powered response
   */
  private async generateResponse(
    content: string,
    businessName: string,
    businessDescription: string,
    keywords: string[],
    config: EngagementConfig,
  ): Promise<string> {
    try {
      if (!this.openai) {
        throw new Error('OpenAI not configured');
      }

      const systemPrompt = this.buildSystemPrompt(businessName, businessDescription, config);
      const userPrompt = this.buildUserPrompt(content, keywords, config);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.maxResponseLength || 200,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content || '';
      
      if (!response) {
        throw new Error('Failed to generate response');
      }

      return response.trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate response: ${msg}`);
      throw error;
    }
  }

  /**
   * Build system prompt for AI
   */
  private buildSystemPrompt(
    businessName: string,
    businessDescription: string,
    config: EngagementConfig,
  ): string {
    let prompt = `You are a ${config.personality} social media engagement bot representing "${businessName}". 

Business Description: ${businessDescription}

Your role is to engage with people who are discussing topics related to our business. Your goal is to be helpful, build relationships, and subtly promote our services when appropriate.

Guidelines:
- Be ${config.personality} and authentic in your responses
- Use a ${config.responseStyle} approach
- Keep responses concise and engaging
- Don't be overly salesy - focus on providing value first
- Acknowledge what the person said and offer relevant help or information
`;

    if (config.includeCallToAction) {
      prompt += `- Include a subtle call-to-action when appropriate (e.g., "Feel free to check out our page" or "DM us if you'd like to learn more")\n`;
    }

    if (config.customInstructions) {
      prompt += `\nAdditional Instructions:\n${config.customInstructions}\n`;
    }

    return prompt;
  }

  /**
   * Build user prompt for AI
   */
  private buildUserPrompt(content: string, keywords: string[], config: EngagementConfig): string {
    return `Someone posted the following content that mentions keywords related to our business: ${keywords.join(', ')}

Content: "${content}"

Generate an engaging ${config.responseStyle} response that:
1. Acknowledges what they said
2. Offers helpful information or assistance
3. Positions our business as a potential solution (subtly)
4. Encourages further conversation

Keep it natural and human-like, not robotic. Maximum ${config.maxResponseLength || 200} characters.`;
  }

  /**
   * Analyze sentiment of content
   */
  private async analyzeSentiment(content: string): Promise<number> {
    try {
      if (!this.openai) {
        return 0; // Neutral if no OpenAI
      }

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Analyze the sentiment of the given text and respond with only a number between -1 (very negative) and 1 (very positive). 0 is neutral.',
          },
          { role: 'user', content },
        ],
        max_tokens: 10,
        temperature: 0.3,
      });

      const sentimentStr = completion.choices[0]?.message?.content || '0';
      const sentiment = parseFloat(sentimentStr);

      return isNaN(sentiment) ? 0 : sentiment;
    } catch (error) {
      this.logger.error(`Failed to analyze sentiment: ${error}`);
      return 0;
    }
  }

  /**
   * Post response to social media platform
   */
  private async postResponse(
    platform: string,
    postId: string,
    commentId: string | null,
    response: string,
    userId: string,
  ): Promise<string> {
    try {
      // Get user's social account
      const socialAccount = await this.prisma.socialAccount.findFirst({
        where: {
          userId,
          platform,
          isActive: true,
        },
      });

      if (!socialAccount) {
        throw new Error(`No active ${platform} account found`);
      }

      let responseId: string;

      switch (platform) {
        case 'FACEBOOK':
          responseId = await this.postFacebookComment(
            socialAccount.accessToken,
            postId,
            commentId,
            response,
          );
          break;
        case 'INSTAGRAM':
          responseId = await this.postInstagramComment(
            socialAccount.accessToken,
            postId,
            commentId,
            response,
          );
          break;
        case 'TWITTER':
          responseId = await this.postTwitterReply(socialAccount.accessToken, postId, response);
          break;
        case 'LINKEDIN':
          responseId = await this.postLinkedInComment(socialAccount.accessToken, postId, response);
          break;
        default:
          throw new Error(`Posting to ${platform} not supported yet`);
      }

      return responseId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to post response to ${platform}: ${msg}`);
      throw error;
    }
  }

  /**
   * Post comment on Facebook
   */
  private async postFacebookComment(
    accessToken: string,
    postId: string,
    commentId: string | null,
    message: string,
  ): Promise<string> {
    const targetId = commentId || postId;
    const result = await this.facebookService.postComment(accessToken, targetId, message);
    return result.id;
  }

  /**
   * Post comment on Instagram
   */
  private async postInstagramComment(
    accessToken: string,
    mediaId: string,
    commentId: string | null,
    text: string,
  ): Promise<string> {
    if (commentId) {
      const result = await this.instagramService.replyToComment(accessToken, commentId, text);
      return result.id;
    } else {
      const result = await this.instagramService.postComment(accessToken, mediaId, text);
      return result.id;
    }
  }

  /**
   * Post reply on Twitter
   */
  private async postTwitterReply(accessToken: string, tweetId: string, text: string): Promise<string> {
    const result = await this.twitterService.replyToTweet(accessToken, tweetId, text);
    return result.id;
  }

  /**
   * Post comment on LinkedIn
   */
  private async postLinkedInComment(accessToken: string, postId: string, text: string): Promise<string> {
    const result = await this.linkedinService.postComment(accessToken, postId, text);
    return result.id;
  }

  /**
   * Get engagement analytics for a campaign
   */
  async getEngagementAnalytics(campaignId: string): Promise<EngagementAnalytics> {
    try {
      const matches = await this.prisma.keywordMatch.findMany({
        where: { campaignId },
      });

      const engagementLogs = await this.prisma.engagementLog.findMany({
        where: { campaignId },
      });

      const totalEngagements = matches.length;
      const successfulEngagements = matches.filter((m) => m.engagementStatus === 'ENGAGED').length;
      const failedEngagements = matches.filter((m) => m.engagementStatus === 'FAILED').length;
      const skippedEngagements = matches.filter((m) => m.engagementStatus === 'SKIPPED').length;

      // Calculate average response time
      const engagedMatches = matches.filter((m) => m.engagedAt);
      const responseTimes = engagedMatches.map(
        (m) => m.engagedAt!.getTime() - m.timestamp.getTime(),
      );
      const averageResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0;

      // Engagements by platform
      const platformCounts: Map<string, number> = new Map();
      matches.forEach((match) => {
        if (match.engagementStatus === 'ENGAGED') {
          platformCounts.set(match.platform, (platformCounts.get(match.platform) || 0) + 1);
        }
      });

      const engagementsByPlatform = Array.from(platformCounts.entries()).map(
        ([platform, count]) => ({ platform, count }),
      );

      // Calculate sentiment impact (average sentiment of engaged matches)
      const engagedWithSentiment = matches.filter(
        (m) => m.engagementStatus === 'ENGAGED' && m.sentimentScore !== null,
      );
      const sentimentImpact =
        engagedWithSentiment.length > 0
          ? engagedWithSentiment.reduce((sum, m) => sum + (m.sentimentScore || 0), 0) /
            engagedWithSentiment.length
          : 0;

      return {
        totalEngagements,
        successfulEngagements,
        failedEngagements,
        skippedEngagements,
        averageResponseTime: Math.round(averageResponseTime / 1000 / 60), // Convert to minutes
        engagementsByPlatform,
        sentimentImpact,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get engagement analytics: ${msg}`);
      throw error;
    }
  }

  /**
   * Get default engagement config
   */
  private getDefaultEngagementConfig(): EngagementConfig {
    return {
      personality: 'professional',
      responseStyle: 'conversational',
      maxResponseLength: 200,
      includeCallToAction: true,
    };
  }

  /**
   * Helper function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

