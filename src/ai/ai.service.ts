import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContentService } from './content/content.service';
import { ContentTemplatesService } from './content/content-templates.service';
import { SEOService } from './seo/seo.service';
import { SocialService } from './social/social.service';
import { ChatbotService, ChatbotConfig } from './chatbot/chatbot.service';
import { AnalyticsService } from './analytics/analytics.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentService: ContentService,
    private readonly contentTemplatesService: ContentTemplatesService,
    private readonly seoService: SEOService,
    private readonly socialService: SocialService,
    private readonly chatbotService: ChatbotService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Generate AI content based on type and parameters
   */
  async generateContent(
    userId: string,
    type: string,
    prompt: string,
    options?: any,
  ) {
    try {
      this.logger.log(`Generating ${type} content for user ${userId}`);
      
      // Track API usage
      await this.trackAPIUsage(userId, 'OPENAI', 'content', 'generate', 0, 0);
      
      const result = await this.contentService.generateContent(type, prompt, options);
      
      // Save generated content to database
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: type.toUpperCase() as any,
          title: options?.title,
          content: result.content,
          prompt,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate SEO-optimized content
   */
  async generateSEOContent(
    userId: string,
    keywords: string[],
    contentType: string,
    options?: any,
  ) {
    try {
      this.logger.log(`Generating SEO content for user ${userId}`);
      
      await this.trackAPIUsage(userId, 'OPENAI', 'seo', 'generate', 0, 0);
      
      const result = await this.seoService.generateSEOContent(keywords, contentType, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'BLOG',
          title: result.title,
          content: result.content,
          prompt: `SEO content for keywords: ${keywords.join(', ')}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: {
            keywords,
            seoScore: result.seoScore,
            ...result.metadata,
          },
        },
      });

      return {
        success: true,
        data: savedContent,
        seoAnalysis: result.seoAnalysis,
      };
    } catch (error) {
      this.logger.error(`Failed to generate SEO content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate social media content
   */
  async generateSocialContent(
    userId: string,
    platform: string,
    campaignId?: string,
    options?: any,
  ) {
    try {
      this.logger.log(`Generating social content for ${platform} for user ${userId}`);
      
      await this.trackAPIUsage(userId, 'OPENAI', 'social', 'generate', 0, 0);
      
      const result = await this.socialService.generateSocialContent(platform, options);
      
      const savedPost = await (this.prisma as any).socialPost.create({
        data: {
          userId,
          campaignId,
          platform: platform.toUpperCase() as any,
          content: result.content,
          hashtags: result.hashtags,
          scheduledAt: options?.scheduledAt ? new Date(options.scheduledAt) : null,
          status: 'draft',
          metrics: result.metrics,
        },
      });

      return {
        success: true,
        data: savedPost,
        engagement: result.engagement,
      };
    } catch (error) {
      this.logger.error(`Failed to generate social content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }


  /**
   * Get AI analytics and insights
   */
  async getAnalytics(
    userId: string,
    campaignId?: string,
    dateRange?: { start: Date; end: Date },
  ) {
    try {
      this.logger.log(`Getting analytics for user ${userId}`);
      
      return await this.analyticsService.getAnalytics(userId, campaignId, dateRange);
    } catch (error) {
      this.logger.error(`Failed to get analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Track API usage for billing and monitoring
   */
  private async trackAPIUsage(
    userId: string,
    provider: string,
    service: string,
    endpoint: string,
    tokensUsed: number,
    cost: number,
  ) {
    try {
      await (this.prisma as any).aPIUsage.create({
        data: {
          userId,
          provider: provider as any,
          service,
          endpoint,
          tokensUsed,
          cost,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track API usage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get AI usage statistics for user
   */
  async getUsageStats(userId: string, period?: { start: Date; end: Date }) {
    try {
      const whereClause: any = { userId };
      
      if (period) {
        whereClause.requestTime = {
          gte: period.start,
          lte: period.end,
        };
      }

      const usage = await (this.prisma as any).aPIUsage.findMany({
        where: whereClause,
        orderBy: { requestTime: 'desc' },
      });

      const stats = usage.reduce((acc: Record<string, { requests: number; tokens: number; cost: number }>, usageItem: any) => {
        if (!acc[usageItem.provider]) {
          acc[usageItem.provider] = { requests: 0, tokens: 0, cost: 0 };
        }
        acc[usageItem.provider].requests += 1;
        acc[usageItem.provider].tokens += usageItem.tokensUsed || 0;
        acc[usageItem.provider].cost += usageItem.cost || 0;
        return acc;
      }, {} as Record<string, { requests: number; tokens: number; cost: number }>);

      return {
        success: true,
        data: {
          totalRequests: usage.length,
        totalTokens: usage.reduce((sum: number, u: any) => sum + (u.tokensUsed || 0), 0),
        totalCost: usage.reduce((sum: number, u: any) => sum + (u.cost || 0), 0),
          byProvider: stats,
          recentUsage: usage.slice(0, 10),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get usage stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Create AI chatbot
   */
  async createChatbot(userId: string, clientId: string | undefined, config: ChatbotConfig, campaignId?: string | undefined) {
    try {
      this.logger.log(`Creating chatbot for user ${userId}`);
      
      const result = await this.chatbotService.createChatbot(config);
      
      // Save chatbot to database
      const savedChatbot = await this.chatbotService.saveChatbotToDatabase(
        userId,
        clientId,
        campaignId,
        config,
        result
      );

      return {
        success: true,
        data: savedChatbot,
        integration: result.integration,
      };
    } catch (error) {
      this.logger.error(`Failed to create chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Process chatbot message
   */
  async processChatbotMessage(
    userId: string,
    chatbotId: string,
    message: string,
    sessionId: string,
    context?: any
  ) {
    try {
      this.logger.log(`Processing chatbot message for user ${userId}`);
      
      const conversationContext = {
        sessionId,
        userId,
        previousMessages: context?.previousMessages || [],
        intent: context?.intent,
        entities: context?.entities,
      };

      const response = await this.chatbotService.processMessage(
        chatbotId,
        message,
        conversationContext
      );

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      this.logger.error(`Failed to process chatbot message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get user chatbots
   */
  async getUserChatbots(userId: string) {
    try {
      this.logger.log(`Getting chatbots for user ${userId}`);
      
      const chatbots = await this.chatbotService.getUserChatbots(userId);

      return {
        success: true,
        data: chatbots,
      };
    } catch (error) {
      this.logger.error(`Failed to get user chatbots: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate blog post content
   */
  async generateBlogPost(userId: string, topic: string, options?: any) {
    try {
      this.logger.log(`Generating blog post for user ${userId}`);
      
      const result = await this.contentService.generateBlogPost(topic, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'BLOG',
          title: options?.title || `Blog Post: ${topic}`,
          content: result.content,
          prompt: `Write a comprehensive blog post about: ${topic}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate blog post: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate ad copy
   */
  async generateAdCopy(userId: string, product: string, targetAudience: string, options?: any) {
    try {
      this.logger.log(`Generating ad copy for user ${userId}`);
      
      const result = await this.contentService.generateAdCopy(product, targetAudience, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'AD_COPY',
          title: options?.title || `Ad Copy: ${product}`,
          content: result.content,
          prompt: `Create compelling ad copy for ${product} targeting ${targetAudience}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate ad copy: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate email content
   */
  async generateEmailContent(userId: string, purpose: string, recipient: string, options?: any) {
    try {
      this.logger.log(`Generating email content for user ${userId}`);
      
      const result = await this.contentService.generateEmailContent(purpose, recipient, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'EMAIL',
          title: options?.title || `Email: ${purpose}`,
          content: result.content,
          prompt: `Write an email for ${purpose} to ${recipient}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate email content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate product description
   */
  async generateProductDescription(userId: string, productName: string, features: string[], options?: any) {
    try {
      this.logger.log(`Generating product description for user ${userId}`);
      
      const result = await this.contentService.generateProductDescription(productName, features, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'PRODUCT_DESCRIPTION',
          title: options?.title || `Product Description: ${productName}`,
          content: result.content,
          prompt: `Create a product description for ${productName} with features: ${features.join(', ')}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate product description: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate video script
   */
  async generateVideoScript(userId: string, topic: string, duration: number, options?: any) {
    try {
      this.logger.log(`Generating video script for user ${userId}`);
      
      const result = await this.contentService.generateVideoScript(topic, duration, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'VIDEO_SCRIPT',
          title: options?.title || `Video Script: ${topic}`,
          content: result.content,
          prompt: `Create a ${duration}-minute video script about: ${topic}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate video script: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate social media captions
   */
  async generateCaptions(userId: string, platform: string, content: string, options?: any) {
    try {
      this.logger.log(`Generating captions for user ${userId}`);
      
      const result = await this.contentService.generateCaptions(platform, content, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'CAPTION',
          title: options?.title || `${platform} Caption`,
          content: result.content,
          prompt: `Create engaging ${platform} captions for: ${content}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate captions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate headlines
   */
  async generateHeadlines(userId: string, topic: string, count: number, options?: any) {
    try {
      this.logger.log(`Generating headlines for user ${userId}`);
      
      const result = await this.contentService.generateHeadlines(topic, count, options);
      
      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: 'HEADLINE',
          title: options?.title || `Headlines: ${topic}`,
          content: result.content,
          prompt: `Generate ${count} compelling headlines for: ${topic}`,
          provider: 'OPENAI',
          model: options?.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: result.metadata,
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate headlines: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get user's generated content
   */
  async getUserContent(userId: string, type?: string, limit: number = 10, offset: number = 0, campaignId?: string) {
    try {
      this.logger.log(`Getting content for user ${userId}${campaignId ? ` for campaign ${campaignId}` : ''}, type: ${type}, limit: ${limit}, offset: ${offset}`);
      
      if (!userId) {
        throw new Error('User ID is required');
      }

      // Validate limit to prevent performance issues
      const safeLimit = Math.min(Math.max(limit, 1), 1000);
      const safeOffset = Math.max(offset, 0);
      
      const whereClause: any = { userId };
      
      // Handle IMAGE type - images are stored in CampaignAsset, not AIContent
      // So we skip type filtering for IMAGE to avoid ContentType enum error
      // Or we could query CampaignAsset separately for images
      if (type && type.toUpperCase() !== 'IMAGE') {
        // Map common type strings to ContentType enum values
        const typeUpper = type.toUpperCase();
        const contentTypeMap: Record<string, string> = {
          'BLOG': 'BLOG',
          'AD_COPY': 'AD_COPY',
          'EMAIL': 'EMAIL',
          'SOCIAL_POST': 'SOCIAL_POST',
          'SOCIAL': 'SOCIAL_POST',
          'PRODUCT_DESCRIPTION': 'PRODUCT_DESCRIPTION',
          'VIDEO_SCRIPT': 'VIDEO_SCRIPT',
          'VIDEO': 'VIDEO_SCRIPT',
          'CAPTION': 'CAPTION',
          'HEADLINE': 'HEADLINE',
        };
        
        if (contentTypeMap[typeUpper]) {
          whereClause.type = contentTypeMap[typeUpper];
        } else {
          // If type is not recognized, skip filtering by type
          this.logger.warn(`Unknown content type: ${typeUpper}, skipping type filter`);
        }
      } else if (type && type.toUpperCase() === 'IMAGE') {
        // Images are stored in CampaignAsset, not AIContent
        // Query CampaignAsset table for images
        this.logger.log('IMAGE type requested - querying CampaignAsset table for images');
        
        const assetWhereClause: any = { 
          userId,
          assetType: 'IMAGE',
        };
        
        if (campaignId) {
          assetWhereClause.campaignId = campaignId;
        }

        const assets = await this.prisma.campaignAsset.findMany({
          where: assetWhereClause,
          orderBy: { createdAt: 'desc' },
          take: safeLimit,
          skip: safeOffset,
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        const total = await this.prisma.campaignAsset.count({
          where: assetWhereClause,
        });

        // Convert CampaignAsset to AIContent-like format for frontend compatibility
        const content = assets.map(asset => {
          // Safely handle metadata - ensure it's an object
          const metadata = asset.metadata && typeof asset.metadata === 'object' 
            ? asset.metadata as Record<string, any>
            : {};
          
          return {
            id: asset.id,
            userId: asset.userId,
            campaignId: asset.campaignId,
            type: 'IMAGE', // Map to IMAGE for frontend
            title: asset.title || undefined,
            content: asset.url || asset.sourceId || '',
            prompt: metadata.prompt || '',
            provider: metadata.provider || 'OPENAI',
            model: metadata.model || undefined,
            tokensUsed: metadata.tokensUsed || undefined,
            cost: metadata.cost || undefined,
            status: asset.status,
            metadata: {
              ...metadata,
              imageUrl: asset.url,
              imageType: metadata.imageType || 'image',
              source: metadata.source || 'campaign',
              revisedPrompt: metadata.revisedPrompt || undefined,
            },
            createdAt: asset.createdAt.toISOString(),
            updatedAt: asset.updatedAt.toISOString(),
            campaign: asset.campaign,
          };
        });

        this.logger.log(`Found ${content.length} image assets out of ${total} total`);

        return {
          success: true,
          data: {
            content,
            pagination: {
              total,
              limit: safeLimit,
              offset: safeOffset,
              hasMore: safeOffset + safeLimit < total,
            },
          },
        };
      }
      
      if (campaignId) {
        whereClause.campaignId = campaignId;
      }

      this.logger.log(`Querying AIContent with where clause: ${JSON.stringify(whereClause)}`);

      const content = await this.prisma.aIContent.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: safeOffset,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const total = await this.prisma.aIContent.count({
        where: whereClause,
      });

      this.logger.log(`Found ${content.length} content items out of ${total} total`);

      return {
        success: true,
        data: {
          content,
          pagination: {
            total,
            limit: safeLimit,
            offset: safeOffset,
            hasMore: safeOffset + safeLimit < total,
          },
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to get user content: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Get specific content by ID
   */
  async getContentById(userId: string, contentId: string) {
    try {
      this.logger.log(`Getting content ${contentId} for user ${userId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      return {
        success: true,
        data: content,
      };
    } catch (error) {
      this.logger.error(`Failed to get content by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Update content
   */
  async updateContent(userId: string, contentId: string, updateData: { title?: string; content?: string; metadata?: any }) {
    try {
      this.logger.log(`Updating content ${contentId} for user ${userId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const updatedContent = await (this.prisma as any).aIContent.update({
        where: { id: contentId },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        data: updatedContent,
      };
    } catch (error) {
      this.logger.error(`Failed to update content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Delete content
   */
  async deleteContent(userId: string, contentId: string) {
    try {
      this.logger.log(`Deleting content ${contentId} for user ${userId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      await (this.prisma as any).aIContent.delete({
        where: { id: contentId },
      });

      return {
        success: true,
        message: 'Content deleted successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to delete content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get all content templates
   */
  async getTemplates(type?: string, industry?: string, search?: string) {
    try {
      this.logger.log('Getting content templates');
      
      let templates;
      if (search) {
        templates = this.contentTemplatesService.searchTemplates(search);
      } else if (type && industry) {
        templates = this.contentTemplatesService.getTemplatesByType(type)
          .filter(t => t.industry === industry || t.industry === 'general');
      } else if (type) {
        templates = this.contentTemplatesService.getTemplatesByType(type);
      } else if (industry) {
        templates = this.contentTemplatesService.getTemplatesByIndustry(industry);
      } else {
        templates = this.contentTemplatesService.getAllTemplates();
      }

      return {
        success: true,
        data: templates,
      };
    } catch (error) {
      this.logger.error(`Failed to get templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get specific template by ID
   */
  async getTemplateById(id: string) {
    try {
      this.logger.log(`Getting template ${id}`);
      
      const template = this.contentTemplatesService.getTemplateById(id);
      if (!template) {
        throw new Error('Template not found');
      }

      return {
        success: true,
        data: template,
      };
    } catch (error) {
      this.logger.error(`Failed to get template: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get industry presets
   */
  async getIndustryPresets() {
    try {
      this.logger.log('Getting industry presets');
      
      const presets = this.contentTemplatesService.getAllIndustryPresets();

      return {
        success: true,
        data: presets,
      };
    } catch (error) {
      this.logger.error(`Failed to get industry presets: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate content using template
   */
  async generateFromTemplate(
    userId: string,
    templateId: string,
    variables: Record<string, string>,
    customOptions?: any
  ) {
    try {
      this.logger.log(`Generating content from template ${templateId} for user ${userId}`);
      
      const { prompt, options } = this.contentTemplatesService.generateFromTemplate(
        templateId,
        variables,
        customOptions
      );

      const result = await this.contentService.generateContent(
        options.templateId.split('-')[0], // Extract type from template ID
        prompt,
        options
      );

      const savedContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          type: options.templateId.split('-')[0].toUpperCase() as any,
          title: options.templateName,
          content: result.content,
          prompt,
          provider: 'OPENAI',
          model: options.model || 'gpt-4',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          metadata: {
            ...result.metadata,
            templateId,
            templateName: options.templateName,
            variables,
          },
        },
      });

      return {
        success: true,
        data: savedContent,
        usage: {
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
        template: {
          id: templateId,
          name: options.templateName,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate from template: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get recommended templates
   */
  async getRecommendedTemplates(type: string, industry?: string, tags?: string[]) {
    try {
      this.logger.log('Getting recommended templates');
      
      const templates = this.contentTemplatesService.getRecommendedTemplates(type, industry, tags);

      return {
        success: true,
        data: templates,
      };
    } catch (error) {
      this.logger.error(`Failed to get recommended templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Create a new version of existing content
   */
  async createContentVersion(
    userId: string,
    contentId: string,
    updateData: { title?: string; content?: string; metadata?: any }
  ) {
    try {
      this.logger.log(`Creating new version of content ${contentId} for user ${userId}`);
      
      const originalContent = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
      });

      if (!originalContent) {
        throw new Error('Content not found');
      }

      // Get the latest version number
      const latestVersion = await (this.prisma as any).aIContent.findFirst({
        where: {
          OR: [
            { id: contentId },
            { parentId: contentId },
          ],
        },
        orderBy: { version: 'desc' },
      });

      const newVersion = (latestVersion?.version || 0) + 1;

      // Create new version
      const newContent = await (this.prisma as any).aIContent.create({
        data: {
          userId,
          campaignId: originalContent.campaignId,
          type: originalContent.type,
          title: updateData.title || originalContent.title,
          content: updateData.content || originalContent.content,
          prompt: originalContent.prompt,
          provider: originalContent.provider,
          model: originalContent.model,
          tokensUsed: originalContent.tokensUsed,
          cost: originalContent.cost,
          status: 'generated',
          metadata: {
            ...originalContent.metadata,
            ...updateData.metadata,
            version: newVersion,
            parentId: originalContent.parentId || contentId,
          },
          version: newVersion,
          parentId: originalContent.parentId || contentId,
        },
      });

      return {
        success: true,
        data: newContent,
        version: newVersion,
      };
    } catch (error) {
      this.logger.error(`Failed to create content version: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get content version history
   */
  async getContentVersions(userId: string, contentId: string) {
    try {
      this.logger.log(`Getting version history for content ${contentId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const parentId = content.parentId || contentId;
      
      const versions = await (this.prisma as any).aIContent.findMany({
        where: {
          OR: [
            { id: parentId },
            { parentId: parentId },
          ],
          userId,
        },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          title: true,
          content: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
        },
      });

      return {
        success: true,
        data: {
          contentId: parentId,
          versions,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get content versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Restore content to a specific version
   */
  async restoreContentVersion(userId: string, contentId: string, version: number) {
    try {
      this.logger.log(`Restoring content ${contentId} to version ${version}`);
      
      const targetVersion = await (this.prisma as any).aIContent.findFirst({
        where: {
          OR: [
            { id: contentId, version },
            { parentId: contentId, version },
          ],
          userId,
        },
      });

      if (!targetVersion) {
        throw new Error('Version not found');
      }

      // Create a new version with the restored content
      const restoredContent = await this.createContentVersion(userId, contentId, {
        title: targetVersion.title,
        content: targetVersion.content,
        metadata: {
          ...targetVersion.metadata,
          restoredFrom: version,
          restoredAt: new Date(),
        },
      });

      return {
        success: true,
        data: restoredContent.data,
        message: `Content restored to version ${version}`,
      };
    } catch (error) {
      this.logger.error(`Failed to restore content version: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Compare two content versions
   */
  async compareContentVersions(
    userId: string,
    contentId: string,
    version1: number,
    version2: number
  ) {
    try {
      this.logger.log(`Comparing versions ${version1} and ${version2} of content ${contentId}`);
      
      const [v1, v2] = await Promise.all([
        (this.prisma as any).aIContent.findFirst({
          where: {
            OR: [
              { id: contentId, version: version1 },
              { parentId: contentId, version: version1 },
            ],
            userId,
          },
        }),
        (this.prisma as any).aIContent.findFirst({
          where: {
            OR: [
              { id: contentId, version: version2 },
              { parentId: contentId, version: version2 },
            ],
            userId,
          },
        }),
      ]);

      if (!v1 || !v2) {
        throw new Error('One or both versions not found');
      }

      return {
        success: true,
        data: {
          version1: {
            version: v1.version,
            title: v1.title,
            content: v1.content,
            createdAt: v1.createdAt,
          },
          version2: {
            version: v2.version,
            title: v2.title,
            content: v2.content,
            createdAt: v2.createdAt,
          },
          differences: {
            titleChanged: v1.title !== v2.title,
            contentChanged: v1.content !== v2.content,
            contentLengthDiff: v2.content.length - v1.content.length,
          },
        },
      };
    } catch (error) {
      this.logger.error(`Failed to compare content versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate multiple pieces of content in batch
   */
  async generateBatchContent(
    userId: string,
    requests: Array<{
      type: string;
      prompt: string;
      options?: any;
      title?: string;
    }>
  ) {
    try {
      this.logger.log(`Generating batch content for user ${userId} - ${requests.length} items`);
      
      const results = await Promise.allSettled(
        requests.map(async (request, index) => {
          try {
            const result = await this.contentService.generateContent(
              request.type,
              request.prompt,
              request.options
            );

            const savedContent = await (this.prisma as any).aIContent.create({
              data: {
                userId,
                type: request.type.toUpperCase() as any,
                title: request.title || `${request.type} - Batch ${index + 1}`,
                content: result.content,
                prompt: request.prompt,
                provider: 'OPENAI',
                model: request.options?.model || 'gpt-4',
                tokensUsed: result.tokensUsed,
                cost: result.cost,
                metadata: {
                  ...result.metadata,
                  batchIndex: index,
                  batchGenerated: true,
                },
              },
            });

            return {
              success: true,
              index,
              data: savedContent,
              usage: {
                tokensUsed: result.tokensUsed,
                cost: result.cost,
              },
            };
          } catch (error) {
            return {
              success: false,
              index,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

      const totalTokens = successful.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value.usage?.tokensUsed || 0) : 0), 0);
      const totalCost = successful.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value.usage?.cost || 0) : 0), 0);

      return {
        success: true,
        data: {
          total: requests.length,
          successful: successful.length,
          failed: failed.length,
          results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' }),
        },
        usage: {
          totalTokens,
          totalCost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate batch content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Generate content variations
   */
  async generateContentVariations(
    userId: string,
    baseContent: {
      type: string;
      prompt: string;
      options?: any;
    },
    variations: Array<{
      name: string;
      modifications: {
        tone?: string;
        length?: string;
        style?: string;
        targetAudience?: string;
      };
    }>
  ) {
    try {
      this.logger.log(`Generating content variations for user ${userId} - ${variations.length} variations`);
      
      const results = await Promise.allSettled(
        variations.map(async (variation, index) => {
          try {
            const modifiedOptions = {
              ...baseContent.options,
              ...variation.modifications,
            };

            const result = await this.contentService.generateContent(
              baseContent.type,
              baseContent.prompt,
              modifiedOptions
            );

            const savedContent = await (this.prisma as any).aIContent.create({
              data: {
                userId,
                type: baseContent.type.toUpperCase() as any,
                title: `${baseContent.type} - ${variation.name}`,
                content: result.content,
                prompt: baseContent.prompt,
                provider: 'OPENAI',
                model: modifiedOptions?.model || 'gpt-4',
                tokensUsed: result.tokensUsed,
                cost: result.cost,
                metadata: {
                  ...result.metadata,
                  variationName: variation.name,
                  variationIndex: index,
                  modifications: variation.modifications,
                  isVariation: true,
                },
              },
            });

            return {
              success: true,
              variation: variation.name,
              data: savedContent,
              usage: {
                tokensUsed: result.tokensUsed,
                cost: result.cost,
              },
            };
          } catch (error) {
            return {
              success: false,
              variation: variation.name,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

      const totalTokens = successful.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value.usage?.tokensUsed || 0) : 0), 0);
      const totalCost = successful.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value.usage?.cost || 0) : 0), 0);

      return {
        success: true,
        data: {
          total: variations.length,
          successful: successful.length,
          failed: failed.length,
          variations: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' }),
        },
        usage: {
          totalTokens,
          totalCost,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate content variations: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Submit content for approval
   */
  async submitForApproval(userId: string, contentId: string, reviewerId?: string) {
    try {
      this.logger.log(`Submitting content ${contentId} for approval`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
          userId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const updatedContent = await (this.prisma as any).aIContent.update({
        where: { id: contentId },
        data: {
          approvalStatus: 'pending',
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        data: updatedContent,
        message: 'Content submitted for approval',
      };
    } catch (error) {
      this.logger.error(`Failed to submit for approval: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Approve content
   */
  async approveContent(
    reviewerId: string,
    contentId: string,
    notes?: string
  ) {
    try {
      this.logger.log(`Approving content ${contentId} by reviewer ${reviewerId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const updatedContent = await (this.prisma as any).aIContent.update({
        where: { id: contentId },
        data: {
          approvalStatus: 'approved',
          approvedBy: reviewerId,
          approvedAt: new Date(),
          reviewerNotes: notes,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        data: updatedContent,
        message: 'Content approved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to approve content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Reject content
   */
  async rejectContent(
    reviewerId: string,
    contentId: string,
    reason: string,
    notes?: string
  ) {
    try {
      this.logger.log(`Rejecting content ${contentId} by reviewer ${reviewerId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const updatedContent = await (this.prisma as any).aIContent.update({
        where: { id: contentId },
        data: {
          approvalStatus: 'rejected',
          approvedBy: reviewerId,
          approvedAt: new Date(),
          rejectionReason: reason,
          reviewerNotes: notes,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        data: updatedContent,
        message: 'Content rejected',
      };
    } catch (error) {
      this.logger.error(`Failed to reject content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Request content revision
   */
  async requestRevision(
    reviewerId: string,
    contentId: string,
    reason: string,
    notes?: string
  ) {
    try {
      this.logger.log(`Requesting revision for content ${contentId} by reviewer ${reviewerId}`);
      
      const content = await (this.prisma as any).aIContent.findFirst({
        where: {
          id: contentId,
        },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      const updatedContent = await (this.prisma as any).aIContent.update({
        where: { id: contentId },
        data: {
          approvalStatus: 'needs_revision',
          approvedBy: reviewerId,
          approvedAt: new Date(),
          rejectionReason: reason,
          reviewerNotes: notes,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        data: updatedContent,
        message: 'Content revision requested',
      };
    } catch (error) {
      this.logger.error(`Failed to request revision: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get content pending approval
   */
  async getPendingApproval(userId?: string) {
    try {
      this.logger.log('Getting content pending approval');
      
      const whereClause: any = {
        approvalStatus: 'pending',
      };

      if (userId) {
        whereClause.userId = userId;
      }

      const pendingContent = await (this.prisma as any).aIContent.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        success: true,
        data: pendingContent,
      };
    } catch (error) {
      this.logger.error(`Failed to get pending approval: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get content approval history
   */
  async getApprovalHistory(userId?: string, status?: string) {
    try {
      this.logger.log('Getting content approval history');
      
      const whereClause: any = {
        approvalStatus: {
          in: ['approved', 'rejected', 'needs_revision'],
        },
      };

      if (userId) {
        whereClause.userId = userId;
      }

      if (status) {
        whereClause.approvalStatus = status;
      }

      const history = await (this.prisma as any).aIContent.findMany({
        where: whereClause,
        orderBy: { approvedAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        success: true,
        data: history,
      };
    } catch (error) {
      this.logger.error(`Failed to get approval history: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
}
