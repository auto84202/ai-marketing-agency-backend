import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CampaignAssetType, CampaignAssetStatus } from '@prisma/client';
import { OpenAIService } from '../../integrations/openai/openai.service';
import { ContentService } from '../content/content.service';
import { SEOService } from '../seo/seo.service';
import { ImageGenerationService } from '../images/image-generation.service';
import { ImprovementSuggestionService } from './improvement-suggestion.service';
import { FacebookService } from '../../integrations/social/facebook.service';
import { InstagramService } from '../../integrations/social/instagram.service';

export interface ChatbotConfig {
  name: string;
  description?: string;
  platform?: string;
  webhookUrl?: string;
  personality?: 'professional' | 'friendly' | 'casual' | 'expert';
  language?: string;
  trainingData?: any[];
  capabilities?: string[];
  faqData?: FAQItem[];
  bookingConfig?: BookingConfig;
  upsellingConfig?: UpsellingConfig;
  multilingualConfig?: MultilingualConfig;
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string[];
  priority: number;
}

export interface BookingConfig {
  enabled: boolean;
  services: BookingService[];
  timeSlots: TimeSlot[];
  bookingUrl?: string;
  confirmationMessage: string;
}

export interface BookingService {
  id: string;
  name: string;
  duration: number; // in minutes
  price?: number;
  description: string;
}

export interface TimeSlot {
  day: string;
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface UpsellingConfig {
  enabled: boolean;
  products: UpsellingProduct[];
  triggers: string[];
  maxSuggestions: number;
}

export interface UpsellingProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  keywords: string[];
}

export interface MultilingualConfig {
  enabled: boolean;
  defaultLanguage: string;
  supportedLanguages: string[];
  autoDetect: boolean;
}

export interface ChatbotResponse {
  apiKey: string;
  settings: any;
  integration: {
    webhookUrl: string;
    apiEndpoint: string;
    documentation: string;
  };
}

export interface ConversationContext {
  sessionId: string;
  userId?: string;
  previousMessages: any[];
  intent?: string;
  entities?: any[];
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private openaiService: OpenAIService,
    private contentService: ContentService,
    private seoService: SEOService,
    private imageGenerationService: ImageGenerationService,
    private improvementSuggestionService: ImprovementSuggestionService,
    private facebookService: FacebookService,
    private instagramService: InstagramService,
  ) {}

  /**
   * Get chatbot configuration from environment
   */
  private getChatbotConfig() {
    return {
      openai: {
        model: this.configService.get('chatbot.openai.model', 'gpt-4'),
        maxTokens: this.configService.get('chatbot.openai.maxTokens', 500),
        temperature: this.configService.get('chatbot.openai.temperature', 0.7),
        topP: this.configService.get('chatbot.openai.topP', 1),
        frequencyPenalty: this.configService.get('chatbot.openai.frequencyPenalty', 0),
        presencePenalty: this.configService.get('chatbot.openai.presencePenalty', 0),
      },
      session: {
        timeoutMinutes: this.configService.get('chatbot.session.timeoutMinutes', 30),
        maxConversationHistory: this.configService.get('chatbot.session.maxConversationHistory', 50),
        defaultLanguage: this.configService.get('chatbot.session.defaultLanguage', 'en'),
      },
      costManagement: {
        limitPerUserMonthly: this.configService.get('chatbot.costManagement.limitPerUserMonthly', 50.00),
        limitPerDay: this.configService.get('chatbot.costManagement.limitPerDay', 100.00),
        alertThresholdPercentage: this.configService.get('chatbot.costManagement.alertThresholdPercentage', 80),
      },
      features: {
        faqEnabled: this.configService.get('chatbot.features.faqEnabled', true),
        bookingEnabled: this.configService.get('chatbot.features.bookingEnabled', true),
        upsellingEnabled: this.configService.get('chatbot.features.upsellingEnabled', true),
        multilingualEnabled: this.configService.get('chatbot.features.multilingualEnabled', true),
        analyticsEnabled: this.configService.get('chatbot.features.analyticsEnabled', true),
      },
    };
  }

  /**
   * Check if user has exceeded cost limits
   */
  private async checkCostLimits(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const config = this.getChatbotConfig();
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Check daily cost limit
      const dailyUsage = await this.prisma.aPIUsage.aggregate({
        where: {
          userId,
          requestTime: { gte: startOfDay },
          service: 'chatbot',
        },
        _sum: { cost: true },
      });

      if (dailyUsage._sum?.cost && dailyUsage._sum.cost > config.costManagement.limitPerDay) {
        return { allowed: false, reason: 'Daily cost limit exceeded' };
      }

      // Check monthly cost limit
      const monthlyUsage = await this.prisma.aPIUsage.aggregate({
        where: {
          userId,
          requestTime: { gte: startOfMonth },
          service: 'chatbot',
        },
        _sum: { cost: true },
      });

      if (monthlyUsage._sum?.cost && monthlyUsage._sum.cost > config.costManagement.limitPerUserMonthly) {
        return { allowed: false, reason: 'Monthly cost limit exceeded' };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error(`Failed to check cost limits: ${error}`);
      return { allowed: true }; // Allow on error to prevent blocking
    }
  }

  /**
   * Record AI usage for cost tracking
   */
  private async recordUsage(
    userId: string,
    chatbotId: string,
    tokensUsed: number,
    cost: number,
    model: string
  ): Promise<void> {
    try {
      await this.prisma.aPIUsage.create({
        data: {
          userId,
          provider: 'OPENAI',
          service: 'chatbot',
          endpoint: `/chatbot/${chatbotId}/message`,
          tokensUsed,
          cost,
          requestTime: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to record usage: ${error}`);
    }
  }

  /**
   * Create a new AI chatbot
   */
  async createChatbot(config: ChatbotConfig): Promise<ChatbotResponse> {
    try {
      this.logger.log(`Creating chatbot: ${config.name}`);

      // Check if OpenAI is configured
      const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!openaiApiKey || openaiApiKey === 'your-openai-api-key-here' || !openaiApiKey.trim() || !openaiApiKey.startsWith('sk-')) {
        this.logger.warn('⚠️  OpenAI API key not configured or invalid in .env file.');
        this.logger.warn('⚠️  Chatbot will use mock responses. To enable real AI, add OPENAI_API_KEY=sk-... to backend/.env');
      } else {
        this.logger.log('✅ OpenAI API key found. Chatbot will use real AI responses.');
      }

      const apiKey = this.generateAPIKey();
      const settings = this.generateChatbotSettings(config);
      const integration = this.setupIntegration(config);

      return {
        apiKey,
        settings,
        integration,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Process incoming message and generate response using OpenAI
   */
  async processMessage(
    chatbotId: string,
    message: string,
    context: ConversationContext,
  ): Promise<any> {
    try {
      this.logger.log(`Processing message for chatbot ${chatbotId}`);

      // Get chatbot configuration
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
      });

      if (!chatbot) {
        throw new Error(`Chatbot with ID ${chatbotId} not found`);
      }

      // Check cost limits if user is provided
      if (context.userId) {
        const costCheck = await this.checkCostLimits(context.userId);
        if (!costCheck.allowed) {
          return {
            response: `I'm sorry, but I've reached my usage limit for today. ${costCheck.reason}. Please try again tomorrow or contact support.`,
            intent: 'limit_exceeded',
            confidence: 1.0,
            metadata: {
              processingTime: Date.now(),
              model: 'limit-checker',
              tokensUsed: 0,
              cost: 0,
              reason: costCheck.reason,
            },
          };
        }
      }

      const config = this.getChatbotConfig();
      const settings = chatbot.settings as any || {};
      const chatbotLanguage = settings.language || 'en';
      const detectedLanguage = this.detectLanguage(message, settings.multilingualConfig, chatbotLanguage);
      const intent = this.detectIntent(message);
      
      // Check for FAQ match first (if enabled)
      if (config.features.faqEnabled) {
        const faqMatch = await this.findFAQMatch(message, settings.faqData);
        if (faqMatch) {
          const response = {
            response: faqMatch.answer,
            intent: 'faq',
            confidence: 0.95,
            metadata: {
              faqId: faqMatch.id,
              category: faqMatch.category,
              processingTime: Date.now(),
              model: 'faq-matcher',
              tokensUsed: 0,
              cost: 0,
            },
          };
          
          await this.saveConversation(chatbotId, context.sessionId, message, response.response, response.intent, response.confidence);
          return response;
        }
      }

      // Check for booking intent (if enabled)
      if (config.features.bookingEnabled && intent === 'booking' && settings.bookingConfig?.enabled) {
        const bookingResponse = await this.handleBookingRequest(message, settings.bookingConfig, detectedLanguage);
        if (bookingResponse) {
          await this.saveConversation(chatbotId, context.sessionId, message, bookingResponse.response, 'booking', 0.9);
          return bookingResponse;
        }
      }

      // Check for upselling opportunities (if enabled)
      const upsellingSuggestions = config.features.upsellingEnabled 
        ? await this.findUpsellingOpportunities(message, settings.upsellingConfig, context)
        : [];
      
      // Get proactive improvement suggestions
      const proactiveSuggestions = await this.improvementSuggestionService.getProactiveSuggestions(
        chatbotId,
        message,
        context.previousMessages || []
      );
      
      // Build conversation context for OpenAI
      const conversationHistory = context.previousMessages || [];
      const systemPrompt = this.buildSystemPrompt(chatbot, context, detectedLanguage);
      
      // Format conversation history for OpenAI (convert to OpenAI message format)
      // Only include the last N messages to stay within token limits
      const maxHistory = config.session.maxConversationHistory || 10;
      const formattedHistory = conversationHistory
        .slice(-maxHistory)
        .map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: typeof msg.content === 'string' ? msg.content : (msg.content || String(msg.content || ''))
        }))
        .filter(msg => msg.content && msg.content.trim().length > 0); // Remove empty messages

      // Generate response using OpenAI with configured parameters
      this.logger.log(`Generating response using ${config.openai.model} with ${config.openai.maxTokens} max tokens`);
      this.logger.debug(`Conversation history: ${formattedHistory.length} messages`);
      
      const openaiResponse = await this.openaiService.generateText(
        message,
        {
          model: config.openai.model,
          maxTokens: config.openai.maxTokens,
          temperature: config.openai.temperature,
          systemPrompt,
          conversationHistory: formattedHistory,
        }
      );
      
      this.logger.log(`OpenAI response generated: ${openaiResponse.tokensUsed} tokens used, cost: $${openaiResponse.cost}`);

      // Record usage for cost tracking
      if (context.userId) {
        await this.recordUsage(
          context.userId,
          chatbotId,
          openaiResponse.tokensUsed,
          openaiResponse.cost,
          openaiResponse.model
        );
      }

      // Combine response with upselling suggestions and proactive suggestions
      let finalResponse = openaiResponse.content;
      if (upsellingSuggestions.length > 0) {
        finalResponse += '\n\n' + this.formatUpsellingSuggestions(upsellingSuggestions, detectedLanguage);
      }
      
      // Add proactive improvement suggestions if appropriate
      if (proactiveSuggestions.length > 0 && conversationHistory.length >= 2) {
        const suggestion = proactiveSuggestions[0]; // Show first relevant suggestion
        if (suggestion && !finalResponse.toLowerCase().includes(suggestion.toLowerCase().substring(0, 10))) {
          finalResponse += `\n\n💡 ${suggestion}`;
        }
      }

      // Process the response
      const response = {
        response: finalResponse,
        intent,
        confidence: 0.9, // High confidence for OpenAI responses
        metadata: {
          processingTime: Date.now(),
          model: openaiResponse.model,
          tokensUsed: openaiResponse.tokensUsed,
          cost: openaiResponse.cost,
          language: detectedLanguage,
          upsellingSuggestions: upsellingSuggestions.length,
          config: {
            maxTokens: config.openai.maxTokens,
            temperature: config.openai.temperature,
          },
        },
      };
      
      // Save conversation to database
      await this.saveConversation(chatbotId, context.sessionId, message, response.response, response.intent, response.confidence);

      return response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process message: ${msg}`);
      
      // Check if OpenAI is configured before falling back to mock
      const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
      const isOpenAIConfigured = openaiApiKey && 
        openaiApiKey !== 'your-openai-api-key-here' && 
        openaiApiKey.trim() !== '' && 
        openaiApiKey.startsWith('sk-');
      
      if (isOpenAIConfigured) {
        // Check for specific error types
        let errorMessage = 'I apologize, but I\'m currently experiencing technical difficulties.';
        
        if (msg.includes('QUOTA_EXCEEDED') || msg.includes('quota') || msg.includes('429') || msg.includes('billing')) {
          errorMessage = 'I apologize, but I\'ve reached my usage limit. Your OpenAI account has exceeded its quota or billing limit. Please check your OpenAI account billing at https://platform.openai.com/account/billing and ensure you have sufficient credits. You may need to add payment method or upgrade your plan.';
        } else if (msg.includes('AUTH_ERROR') || msg.includes('401') || msg.includes('Invalid API key')) {
          errorMessage = 'I apologize, but there\'s an authentication issue. Please verify your OpenAI API key in the backend .env file is correct and valid.';
        } else {
          errorMessage = `I apologize, but I'm experiencing technical difficulties. ${msg}`;
        }
        
        const errorResponse = {
          response: errorMessage,
          intent: 'error',
          confidence: 0,
          metadata: {
            processingTime: Date.now(),
            model: 'error-handler',
            tokensUsed: 0,
            cost: 0,
            error: msg,
            openaiConfigured: true,
          },
        };
        await this.saveConversation(chatbotId, context.sessionId, message, errorResponse.response, errorResponse.intent, errorResponse.confidence);
        return errorResponse;
      }
      
      // Only use mock if OpenAI is not configured
      this.logger.warn('⚠️  Using mock response because OpenAI is not configured.');
      this.logger.warn('⚠️  Add OPENAI_API_KEY=sk-... to backend/.env file for real AI responses.');
      const fallbackResponse = await this.generateMockResponse(message, context);
      await this.saveConversation(chatbotId, context.sessionId, message, fallbackResponse.response, fallbackResponse.intent, fallbackResponse.confidence);
      
      return fallbackResponse;
    }
  }

  /**
   * Train chatbot with custom data
   * TODO: Implement when OpenAI API key is provided
   */
  async trainChatbot(chatbotId: string, trainingData: any[]): Promise<any> {
    try {
      this.logger.log(`Training chatbot ${chatbotId} with ${trainingData.length} examples`);

      // TODO: Implement fine-tuning with OpenAI API
      const result = this.generateMockTrainingResult(trainingData);

      // Update chatbot with training data
      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: {
          trainingData,
          settings: {
            ...result.settings,
            lastTrained: new Date(),
          },
        },
      });

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to train chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Analyze chatbot performance
   */
  async analyzePerformance(chatbotId: string, dateRange?: { start: Date; end: Date }): Promise<any> {
    try {
      this.logger.log(`Analyzing performance for chatbot ${chatbotId}`);

      const whereClause: any = { chatbotId };
      
      if (dateRange) {
        whereClause.createdAt = {
          gte: dateRange.start,
          lte: dateRange.end,
        };
      }

      const conversations = await this.prisma.conversation.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
      });

      const analytics = this.calculateChatbotAnalytics(conversations);

      // Update chatbot analytics
      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: {
          analytics,
        },
      });

      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to analyze performance: ${msg}`);
      throw error;
    }
  }

  /**
   * Get chatbot conversation history
   */
  async getConversationHistory(
    chatbotId: string,
    sessionId?: string,
    limit: number = 50,
  ): Promise<any> {
    try {
      this.logger.log(`Getting conversation history for chatbot ${chatbotId}`);

      const whereClause: any = { chatbotId };
      if (sessionId) {
        whereClause.sessionId = sessionId;
      }

      const conversations = await this.prisma.conversation.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return {
        success: true,
        data: conversations,
        total: conversations.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get conversation history: ${msg}`);
      throw error;
    }
  }

  /**
   * Update chatbot settings
   */
  async updateChatbotSettings(chatbotId: string, settings: any): Promise<any> {
    try {
      this.logger.log(`Updating settings for chatbot ${chatbotId}`);

      const updatedChatbot = await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: {
          settings: {
            ...settings,
            lastUpdated: new Date(),
          },
        },
      });

      return {
        success: true,
        data: updatedChatbot,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update chatbot settings: ${msg}`);
      throw error;
    }
  }

  /**
   * Activate chatbot (makes it ACTIVE)
   */
  async activateChatbot(chatbotId: string): Promise<any> {
    try {
      this.logger.log(`Activating chatbot ${chatbotId}`);

      const chatbot = await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: {
          status: 'ACTIVE',
        },
        include: {
          campaign: true,
        },
      });

      // If chatbot is linked to a campaign, generate AI content automatically
      // This triggers when chatbot is activated for a campaign
      if (chatbot.campaignId && chatbot.campaign) {
        const campaign = chatbot.campaign;
        this.logger.log(`Chatbot ${chatbotId} activated for campaign ${campaign.id}. Triggering automatic content generation...`);
        
        // Check if campaign has description (required for content generation)
        if (!campaign.description || campaign.description.trim() === '') {
          this.logger.warn(`Campaign ${campaign.id} does not have a description. Content generation requires campaign description. Please add a description to the campaign.`);
          return {
            success: true,
            chatbot,
            warning: 'Campaign description is required for automatic content generation. Please add a description to enable content generation.',
          };
        }

        // Generate content in background (don't block activation)
        this.generateCampaignContent(chatbot.userId, campaign.id, campaign).catch((error) => {
          this.logger.error(`Failed to generate campaign content: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });

        return {
          success: true,
          chatbot,
          message: `Chatbot activated successfully. Automatic content generation started for campaign ${campaign.id}.`,
        };
      }

      return {
        success: true,
        chatbot,
        message: chatbot.campaignId && chatbot.campaign && (chatbot.campaign.status === 'active' || chatbot.campaign.status === 'running')
          ? 'Chatbot activated. AI content generation started.'
          : 'Chatbot activated.',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to activate chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Deploy chatbot to platform
   */
  async deployChatbot(chatbotId: string, platform: string): Promise<any> {
    try {
      this.logger.log(`Deploying chatbot ${chatbotId} to ${platform}`);

      // TODO: Implement platform-specific deployment
      const deployment = this.generateMockDeployment(platform);

      // Update chatbot status to ACTIVE
      const chatbot = await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: {
          status: 'ACTIVE',
          platform,
        },
        include: {
          campaign: true,
        },
      });

      // If chatbot is linked to a campaign, generate AI content automatically
      // This triggers when chatbot is deployed for a campaign
      if (chatbot.campaignId && chatbot.campaign) {
        const campaign = chatbot.campaign;
        this.logger.log(`Chatbot ${chatbotId} deployed for campaign ${campaign.id}. Triggering automatic content generation...`);
        
        // Check if campaign has description (required for content generation)
        if (!campaign.description || campaign.description.trim() === '') {
          this.logger.warn(`Campaign ${campaign.id} does not have a description. Content generation requires campaign description. Please add a description to the campaign.`);
          return {
            success: true,
            deployment,
            warning: 'Campaign description is required for automatic content generation. Please add a description to enable content generation.',
          };
        }

        // Generate content in background (don't block deployment)
        this.generateCampaignContent(chatbot.userId, campaign.id, campaign).catch((error) => {
          this.logger.error(`Failed to generate campaign content: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });

        return {
          success: true,
          deployment,
          message: `Chatbot deployed successfully. Automatic content generation started for campaign ${campaign.id}.`,
        };
      }

      return {
        success: true,
        deployment,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to deploy chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate AI content based on campaign settings
   * This is called when both campaign and chatbot are active
   * Primary data source: Campaign description, with supporting data from business profile, audience, goals, and keywords
   */
  async generateCampaignContent(userId: string, campaignId: string, campaign: any): Promise<void> {
    try {
      this.logger.log(`Generating AI content for campaign ${campaignId}`);

      const settings = (campaign.settings as Record<string, any>) || {};
      const businessProfile = settings.businessProfile || {};
      const audienceProfile = settings.audienceProfile || {};
      const goals = settings.goals || [];
      const focusKeywords = settings.focusKeywords || [];

      // Primary source: Campaign description
      // Fallback to business profile data, then campaign name
      const campaignDescription = campaign.description || '';
      const businessContext = businessProfile.primaryProductOrService || businessProfile.companyName || '';
      const campaignName = campaign.name || '';
      
      // Build comprehensive context from all available data
      const brandVoice = businessProfile.brandVoice || 'professional';
      const companyName = businessProfile.companyName || '';
      const industry = businessProfile.industry || '';
      const targetAudience = audienceProfile.demographics || audienceProfile.interests || '';
      const painPoints = audienceProfile.painPoints || [];
      
      // Create a rich context prompt combining all campaign data
      let contentContext = campaignDescription;
      
      if (!contentContext && businessContext) {
        contentContext = businessContext;
      }
      
      if (!contentContext && campaignName) {
        contentContext = campaignName;
      }

      if (!contentContext) {
        this.logger.error(`Campaign description is required for content generation. Campaign ${campaignId} has no description. Please add a description to the campaign and try again.`);
        throw new Error(`Campaign description is required for automatic content generation. Please add a description to campaign ${campaignId}.`);
      }

      // Build comprehensive prompt context
      const contextDetails: string[] = [];
      
      if (companyName) contextDetails.push(`Company: ${companyName}`);
      if (industry) contextDetails.push(`Industry: ${industry}`);
      if (targetAudience) contextDetails.push(`Target Audience: ${targetAudience}`);
      if (painPoints.length > 0) contextDetails.push(`Pain Points: ${painPoints.join(', ')}`);
      if (goals.length > 0) contextDetails.push(`Campaign Goals: ${goals.join(', ')}`);
      if (focusKeywords.length > 0) contextDetails.push(`Keywords: ${focusKeywords.join(', ')}`);
      
      const fullContext = contextDetails.length > 0 
        ? `${contentContext}\n\nAdditional Context:\n${contextDetails.join('\n')}`
        : contentContext;

      // Get chatbot language setting if available
      let contentLanguage = 'en';
      try {
        const chatbot = await this.prisma.chatbot.findFirst({
          where: { 
            campaignId,
            userId,
            status: 'ACTIVE',
          },
          select: { settings: true },
        });
        
        if (chatbot?.settings) {
          const chatbotSettings = chatbot.settings as any;
          // Get language priority: multilingualConfig.defaultLanguage > chatbot.language > 'en'
          if (chatbotSettings.multilingualConfig?.enabled) {
            contentLanguage = chatbotSettings.multilingualConfig.defaultLanguage || chatbotSettings.language || 'en';
          } else if (chatbotSettings.language) {
            // Use chatbot's configured language for all content generation
            contentLanguage = chatbotSettings.language;
          }
        }
      } catch (error) {
        this.logger.warn(`Could not get chatbot language setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 1. Generate blog post content based on campaign description
      try {
        // Add language instruction to blog prompt
        const languageInstruction = contentLanguage !== 'en' 
          ? `\n\nIMPORTANT: Write the entire blog post in ${this.getLanguageName(contentLanguage)}. All content must be in ${this.getLanguageName(contentLanguage)}.`
          : '';
        
        const blogPrompt = `Write a comprehensive, engaging blog post based on this campaign description:\n\n${fullContext}\n\nMake it informative, valuable, and aligned with the campaign goals. Use a ${brandVoice} tone.${languageInstruction}`;
        
        const blogResult = await this.contentService.generateContent(
          'blog',
          blogPrompt,
          {
            keywords: focusKeywords,
            tone: brandVoice,
            length: 'long',
            language: contentLanguage,
          }
        );

        await this.prisma.aIContent.create({
          data: {
            userId,
            campaignId,
            type: 'BLOG',
            title: `Blog Post: ${campaignName || 'Campaign Content'}`,
            content: blogResult.content,
            prompt: blogPrompt,
            provider: 'OPENAI',
            model: 'gpt-4',
            tokensUsed: blogResult.tokensUsed,
            cost: blogResult.cost,
            metadata: { 
              ...blogResult.metadata, 
              source: 'campaign_description',
              keywords: focusKeywords,
              goals: goals,
            },
            status: 'generated',
            approvalStatus: 'pending',
          },
        });

        this.logger.log(`Generated blog post for campaign ${campaignId} based on campaign description`);
      } catch (error) {
        this.logger.error(`Failed to generate blog post: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 2. Generate social media posts based on campaign description
      const platforms = ['TWITTER', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN'];
      for (const platform of platforms) {
        try {
          const platformGuidelines = {
            TWITTER: 'Keep it concise (under 280 characters), use trending hashtags, include a call to action',
            FACEBOOK: 'Make it engaging and shareable, encourage comments and reactions',
            INSTAGRAM: 'Visual-focused storytelling, use relevant hashtags (5-10 hashtags)',
            LINKEDIN: 'Professional tone with insights, focus on industry value and thought leadership',
          };

          // Add language instruction to social post prompt
          const languageInstruction = contentLanguage !== 'en' 
            ? `\n\nIMPORTANT: Write the entire post in ${this.getLanguageName(contentLanguage)}. All content must be in ${this.getLanguageName(contentLanguage)}.`
            : '';
          
          const socialPrompt = `Create an engaging ${platform.toLowerCase()} post based on this campaign description:\n\n${fullContext}\n\n${platformGuidelines[platform as keyof typeof platformGuidelines] || ''}\n\nUse a ${brandVoice} tone and include relevant hashtags and a call to action.${languageInstruction}`;
          
          const socialResult = await this.contentService.generateContent(
            'social_post',
            socialPrompt,
            {
              keywords: focusKeywords,
              tone: brandVoice,
              length: 'short',
              language: contentLanguage,
            }
          );

          // Extract hashtags from keywords and add to hashtags field
          const hashtags = focusKeywords.slice(0, 5)
            .map((k: string) => `#${k.replace(/\s+/g, '').replace(/#/g, '')}`)
            .join(' ');

          await this.prisma.socialPost.create({
            data: {
              userId,
              campaignId,
              platform: platform as any,
              content: socialResult.content,
              hashtags: hashtags,
              aiGenerated: true,
              status: 'DRAFT',
              mediaUrls: '',
              generationPrompt: JSON.stringify({ 
                source: 'campaign_description',
                description: campaignDescription,
                platform, 
                keywords: focusKeywords,
                goals: goals,
              }),
            },
          });

          this.logger.log(`Generated ${platform} post for campaign ${campaignId} based on campaign description`);
        } catch (error) {
          this.logger.error(`Failed to generate ${platform} post: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // 3. Generate SEO content based on campaign description
      try {
        // Add language instruction to SEO prompt
        const languageInstruction = contentLanguage !== 'en' 
          ? `\n\nIMPORTANT: Write the entire SEO content in ${this.getLanguageName(contentLanguage)}. All content must be in ${this.getLanguageName(contentLanguage)}.`
          : '';
        
        const seoPrompt = `Create SEO-optimized content based on this campaign description:\n\n${fullContext}\n\n${focusKeywords.length > 0 ? `Focus on these keywords: ${focusKeywords.join(', ')}. ` : ''}Make it valuable, informative, and optimized for search engines while maintaining readability.${languageInstruction}`;
        
        const seoResult = await this.contentService.generateContent(
          'blog',
          seoPrompt,
          {
            keywords: focusKeywords,
            tone: brandVoice,
            length: 'long',
            language: contentLanguage,
          }
        );

        await this.prisma.aIContent.create({
          data: {
            userId,
            campaignId,
            type: 'BLOG',
            title: `SEO Content: ${campaignName || 'Campaign SEO'}`,
            content: seoResult.content,
            prompt: seoPrompt,
            provider: 'OPENAI',
            model: 'gpt-4',
            tokensUsed: seoResult.tokensUsed,
            cost: seoResult.cost,
            metadata: { 
              ...seoResult.metadata, 
              source: 'campaign_description',
              keywords: focusKeywords,
              goals: goals,
            },
            status: 'generated',
            approvalStatus: 'pending',
          },
        });

        this.logger.log(`Generated SEO content for campaign ${campaignId} based on campaign description`);
      } catch (error) {
        this.logger.error(`Failed to generate SEO content: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 4. Generate images based on campaign description
      try {
        this.logger.log(`Starting image generation for campaign ${campaignId}`);
        
        const imagePrompts = [
          // Hero/Banner image
          `Create a professional marketing banner image for: ${campaignDescription}. Style: modern, engaging, brand-appropriate for ${companyName || 'this campaign'}.`,
          // Social media image
          `Create an eye-catching social media image for: ${campaignDescription}. Style: vibrant, shareable, optimized for social platforms.`,
          // Blog post featured image
          `Create a featured blog post image illustrating: ${campaignDescription}. Style: informative, visually appealing, professional.`,
        ];

        let imagesGenerated = 0;

        for (let i = 0; i < imagePrompts.length; i++) {
          try {
            const imagePrompt = imagePrompts[i];
            this.logger.log(`Generating image ${i + 1}/3 for campaign ${campaignId}...`);
            
            const imageResult = await this.imageGenerationService.generateImages(imagePrompt, {
              size: '1024x1024',
              quality: 'hd',
              style: 'vivid',
              n: 1,
            });

            this.logger.log(`Image generation result received for image ${i + 1}: ${imageResult.images?.length || 0} images`);

            if (imageResult.images && imageResult.images.length > 0) {
              const image = imageResult.images[0];
              
              if (!image.url) {
                this.logger.warn(`Image ${i + 1} generated but URL is missing. Result: ${JSON.stringify(image)}`);
                continue;
              }
              
              // Save image reference in campaign assets
              const savedImage = await this.prisma.campaignAsset.create({
                data: {
                  campaignId,
                  userId,
                  assetType: CampaignAssetType.IMAGE,
                  sourceType: 'AI_IMAGE',
                  sourceId: image.url,
                  title: `Generated Image ${i + 1}: ${campaignName || 'Campaign Image'}`,
                  url: image.url,
                  status: CampaignAssetStatus.READY,
                  metadata: {
                    ...imageResult.metadata,
                    source: 'campaign_description',
                    imageUrl: image.url,
                    revisedPrompt: image.revised_prompt || imagePrompt,
                    imageType: i === 0 ? 'banner' : i === 1 ? 'social' : 'blog_featured',
                    prompt: imagePrompt,
                    provider: 'OPENAI',
                    model: imageResult.metadata?.model || 'dall-e-3',
                    tokensUsed: imageResult.tokensUsed || 0,
                    cost: imageResult.cost || 0,
                  },
                },
              });

              imagesGenerated++;
              this.logger.log(`✓ Generated and saved image ${i + 1} (${i === 0 ? 'banner' : i === 1 ? 'social' : 'blog_featured'}) for campaign ${campaignId}. Image ID: ${savedImage.id}, URL: ${image.url.substring(0, 50)}...`);
            } else {
              this.logger.warn(`Image ${i + 1} generation returned no images. Result: ${JSON.stringify(imageResult)}`);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            this.logger.error(`Failed to generate image ${i + 1} for campaign ${campaignId}: ${errorMsg}`, errorStack);
          }
        }

        if (imagesGenerated > 0) {
          this.logger.log(`Successfully generated ${imagesGenerated}/${imagePrompts.length} images for campaign ${campaignId}`);
        } else {
          this.logger.warn(`No images were generated for campaign ${campaignId}. Check image generation service configuration and logs.`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';
        this.logger.error(`Failed to generate images for campaign ${campaignId}: ${errorMsg}`, errorStack);
      }

      // Extract keywords from campaign description for Facebook and Instagram search
      // Combine focusKeywords, campaign description, and business context for better results
      let searchKeywords = '';
      
      if (focusKeywords.length > 0) {
        // Use focus keywords as primary search terms
        searchKeywords = focusKeywords.join(' ');
      } else if (campaignDescription) {
        // Extract key terms from campaign description (remove common words)
        const commonWords = ['the', 'this', 'that', 'with', 'from', 'about', 'your', 'their', 'these', 'those', 'and', 'or', 'but', 'for', 'are', 'was', 'were'];
        const words = campaignDescription
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter((word: string) => word.length > 3) // Filter short words
          .filter((word: string) => !commonWords.includes(word))
          .slice(0, 5); // Take first 5 meaningful words
        searchKeywords = words.join(' ') || campaignDescription.split(/\s+/).slice(0, 5).join(' ');
      }
      
      // Add business context if available and not already included
      if (businessContext && businessContext.trim() && searchKeywords && !searchKeywords.toLowerCase().includes(businessContext.toLowerCase())) {
        searchKeywords = `${searchKeywords} ${businessContext}`.trim();
      }

      // 5. Fetch Facebook posts, comments, and hashtags based on campaign description
      try {
        this.logger.log(`Fetching Facebook data for campaign ${campaignId} based on campaign description`);

        this.logger.log(`Searching Facebook posts with keywords: "${searchKeywords}" for campaign ${campaignId}`);

        if (searchKeywords && searchKeywords.trim()) {
          // Search Facebook posts
          const facebookPosts = await this.facebookService.searchPosts(
            searchKeywords,
            undefined, // Use token from .env
            {
              maxResults: 20,
            }
          );

          this.logger.log(`Found ${facebookPosts.length} Facebook posts matching keywords "${searchKeywords}" for campaign ${campaignId}`);

          // Save Facebook posts to database
          for (const fbPost of facebookPosts) {
            try {
              // Check if post already exists
              const existingPost = await this.prisma.socialPost.findFirst({
                where: {
                  platformPostId: fbPost.id,
                  platform: 'FACEBOOK',
                },
              });

              if (!existingPost) {
                // Extract hashtags from post
                const hashtags = this.facebookService.extractHashtags(fbPost.message || '');
                
                // Ensure permalink is properly formatted and valid
                let permalink = fbPost.permalink;
                if (!permalink || !permalink.startsWith('http')) {
                  if (fbPost.id) {
                    // Construct proper Facebook URL
                    if (fbPost.id.includes('_')) {
                      const [pageId, postId] = fbPost.id.split('_');
                      permalink = `https://www.facebook.com/${pageId}/posts/${postId}`;
                    } else {
                      permalink = `https://www.facebook.com/${fbPost.id}`;
                    }
                  } else {
                    permalink = null;
                  }
                }
                
                // Create social post record
                const savedPost = await this.prisma.socialPost.create({
                  data: {
                    userId,
                    campaignId,
                    platform: 'FACEBOOK',
                    content: fbPost.message || '',
                    mediaUrls: fbPost.mediaUrl || '',
                    hashtags: hashtags.join(', '),
                    postedAt: fbPost.createdTime ? new Date(fbPost.createdTime) : new Date(),
                    metrics: {
                      likes: fbPost.metrics?.likes || 0,
                      comments: fbPost.metrics?.comments || 0,
                      shares: fbPost.metrics?.shares || 0,
                      permalink: permalink, // Store permalink in metrics
                    },
                    platformPostId: fbPost.id,
                    status: 'DRAFT',
                    aiGenerated: false,
                  },
                });
                
                this.logger.log(`Saved Facebook post ${fbPost.id} with permalink: ${permalink}`);

                // Fetch comments for this post
                try {
                  const comments = await this.facebookService.getPostComments(fbPost.id, undefined, {
                    maxResults: 50,
                  });

                  this.logger.log(`Found ${comments.length} comments for post ${fbPost.id}`);

                  // Save comments to database
                  for (const comment of comments) {
                    await this.prisma.socialComment.create({
                      data: {
                        postId: savedPost.id,
                        platform: 'FACEBOOK',
                        commentId: comment.id,
                        authorId: comment.author?.id,
                        authorName: comment.author?.name || 'Unknown',
                        authorAvatar: comment.author?.picture,
                        content: comment.message || '',
                        needsResponse: false,
                        priority: 'NORMAL',
                        createdAt: comment.createdTime ? new Date(comment.createdTime) : new Date(),
                      },
                    });
                  }
                } catch (commentError) {
                  const errorMsg = commentError instanceof Error ? commentError.message : 'Unknown error';
                  this.logger.warn(`Failed to fetch comments for post ${fbPost.id}: ${errorMsg}`);
                  // Continue with other posts even if comments fail
                }
              }
            } catch (postError) {
              const errorMsg = postError instanceof Error ? postError.message : 'Unknown error';
              this.logger.error(`Failed to save Facebook post ${fbPost.id}: ${errorMsg}`);
              // Continue with other posts
            }
          }

          // Extract and save trending hashtags from all posts
          const allHashtags = this.facebookService.extractHashtagsFromPosts(facebookPosts);
          
          if (allHashtags.length > 0) {
            this.logger.log(`Extracted ${allHashtags.length} unique hashtags from Facebook posts`);
            
            // Update campaign with trending hashtags
            const campaignSettings = (campaign.settings as Record<string, any>) || {};
            const existingTrendTags = campaignSettings.trendTags || [];
            const uniqueTrendTags = Array.from(new Set([...existingTrendTags, ...allHashtags]));
            
            await this.prisma.campaign.update({
              where: { id: campaignId },
              data: {
                settings: {
                  ...campaignSettings,
                  trendTags: uniqueTrendTags.slice(0, 50), // Limit to 50 hashtags
                  facebookFetchedAt: new Date().toISOString(),
                  facebookPostsCount: facebookPosts.length,
                },
              },
            });

            // Also save individual trending topics
            for (const hashtag of allHashtags.slice(0, 20)) { // Save top 20 hashtags
              // Check if topic already exists
              const existingTopic = await this.prisma.trendingTopic.findFirst({
                where: {
                  platform: 'FACEBOOK',
                  topic: hashtag,
                },
              });

              if (existingTopic) {
                // Update existing topic
                await this.prisma.trendingTopic.update({
                  where: { id: existingTopic.id },
                  data: {
                    volume: (existingTopic.volume || 0) + 1,
                    updatedAt: new Date(),
                  },
                });
              } else {
                // Create new topic
                await this.prisma.trendingTopic.create({
                  data: {
                    platform: 'FACEBOOK',
                    topic: hashtag,
                    hashtag: `#${hashtag}`,
                    description: `Trending hashtag from campaign ${campaignName}`,
                    volume: 1,
                    relevanceScore: 0.8,
                  },
                });
              }
            }
          }
        } else {
          this.logger.warn(`No search keywords available for Facebook search in campaign ${campaignId}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';
        this.logger.error(`Failed to fetch Facebook data for campaign ${campaignId}: ${errorMsg}`, errorStack);
        // Don't throw - allow other content generation to continue
      }

      // 6. Fetch Instagram posts, comments, and hashtags based on campaign description
      try {
        this.logger.log(`Fetching Instagram data for campaign ${campaignId} based on campaign description`);
        
        // Use same search keywords as Facebook
        if (searchKeywords && searchKeywords.trim()) {
          // Search Instagram posts
          const instagramPosts = await this.instagramService.searchPosts(
            searchKeywords,
            undefined, // Use token from .env
            {
              maxResults: 20,
            }
          );

          this.logger.log(`Found ${instagramPosts.length} Instagram posts matching keywords "${searchKeywords}" for campaign ${campaignId}`);

          // Save Instagram posts to database
          for (const igPost of instagramPosts) {
            try {
              // Check if post already exists
              const existingPost = await this.prisma.socialPost.findFirst({
                where: {
                  platformPostId: igPost.id,
                  platform: 'INSTAGRAM',
                },
              });

              if (!existingPost) {
                // Extract hashtags from post
                const hashtags = this.instagramService.extractHashtags(igPost.caption || '');
                
                // Ensure permalink is properly formatted and valid
                let permalink = igPost.permalink;
                if (!permalink || !permalink.startsWith('http')) {
                  if (igPost.id) {
                    permalink = `https://www.instagram.com/p/${igPost.id}/`;
                  } else {
                    permalink = null;
                  }
                }
                
                // Create social post record
                const savedPost = await this.prisma.socialPost.create({
                  data: {
                    userId,
                    campaignId,
                    platform: 'INSTAGRAM',
                    content: igPost.caption || '',
                    mediaUrls: igPost.mediaUrl || '',
                    hashtags: hashtags.join(', '),
                    postedAt: igPost.createdTime ? new Date(igPost.createdTime) : new Date(),
                    metrics: {
                      likes: igPost.metrics?.likes || 0,
                      comments: igPost.metrics?.comments || 0,
                      permalink: permalink, // Store permalink in metrics
                    },
                    platformPostId: igPost.id,
                    status: 'DRAFT',
                    aiGenerated: false,
                  },
                });

                // Fetch comments for this post
                try {
                  const comments = await this.instagramService.getPostComments(igPost.id, undefined, {
                    maxResults: 50,
                  });

                  this.logger.log(`Found ${comments.length} comments for Instagram post ${igPost.id}`);

                  // Save comments to database
                  for (const comment of comments) {
                    await this.prisma.socialComment.create({
                      data: {
                        postId: savedPost.id,
                        platform: 'INSTAGRAM',
                        commentId: comment.id,
                        authorId: comment.author?.id,
                        authorName: comment.author?.username || 'Unknown',
                        authorAvatar: undefined,
                        content: comment.message || '',
                        needsResponse: false,
                        priority: 'NORMAL',
                        createdAt: comment.createdTime ? new Date(comment.createdTime) : new Date(),
                      },
                    });
                  }
                } catch (commentError) {
                  const errorMsg = commentError instanceof Error ? commentError.message : 'Unknown error';
                  this.logger.warn(`Failed to fetch comments for Instagram post ${igPost.id}: ${errorMsg}`);
                  // Continue with other posts even if comments fail
                }
              }
            } catch (postError) {
              const errorMsg = postError instanceof Error ? postError.message : 'Unknown error';
              this.logger.error(`Failed to save Instagram post ${igPost.id}: ${errorMsg}`);
              // Continue with other posts
            }
          }

          // Extract and save trending hashtags from all posts
          const allInstagramHashtags = new Set<string>();
          instagramPosts.forEach(post => {
            if (post.caption) {
              const hashtags = this.instagramService.extractHashtags(post.caption);
              hashtags.forEach(tag => allInstagramHashtags.add(tag.toLowerCase()));
            }
          });
          
          if (allInstagramHashtags.size > 0) {
            this.logger.log(`Extracted ${allInstagramHashtags.size} unique hashtags from Instagram posts`);
            
            // Update campaign with trending hashtags
            const campaignSettings = (campaign.settings as Record<string, any>) || {};
            const existingTrendTags = campaignSettings.trendTags || [];
            const uniqueTrendTags = Array.from(new Set([...existingTrendTags, ...Array.from(allInstagramHashtags)]));
            
            await this.prisma.campaign.update({
              where: { id: campaignId },
              data: {
                settings: {
                  ...campaignSettings,
                  trendTags: uniqueTrendTags.slice(0, 50), // Limit to 50 hashtags
                  instagramFetchedAt: new Date().toISOString(),
                  instagramPostsCount: instagramPosts.length,
                },
              },
            });

            // Also save individual trending topics
            for (const hashtag of Array.from(allInstagramHashtags).slice(0, 20)) { // Save top 20 hashtags
              // Check if topic already exists
              const existingTopic = await this.prisma.trendingTopic.findFirst({
                where: {
                  platform: 'INSTAGRAM',
                  topic: hashtag,
                },
              });

              if (existingTopic) {
                // Update existing topic
                await this.prisma.trendingTopic.update({
                  where: { id: existingTopic.id },
                  data: {
                    volume: (existingTopic.volume || 0) + 1,
                    updatedAt: new Date(),
                  },
                });
              } else {
                // Create new topic
                await this.prisma.trendingTopic.create({
                  data: {
                    platform: 'INSTAGRAM',
                    topic: hashtag,
                    hashtag: `#${hashtag}`,
                    description: `Trending hashtag from campaign ${campaignName}`,
                    volume: 1,
                    relevanceScore: 0.8,
                  },
                });
              }
            }
          }
        }
      } catch (instagramError) {
        const errorMsg = instagramError instanceof Error ? instagramError.message : 'Unknown error';
        this.logger.error(`Failed to fetch Instagram data for campaign ${campaignId}: ${errorMsg}`);
        // Don't throw - allow other content generation to continue
      }

      this.logger.log(`Successfully generated all AI content (blog, social posts, SEO, images, Facebook & Instagram data) for campaign ${campaignId} based on campaign description`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate campaign content: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate API key for chatbot
   */
  private generateAPIKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'cb_';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate chatbot settings
   */
  private generateChatbotSettings(config: ChatbotConfig): any {
    return {
      personality: config.personality || 'friendly',
      language: config.language || 'en',
      capabilities: config.capabilities || ['general_chat', 'faq', 'booking'],
      responseStyle: {
        tone: config.personality || 'friendly',
        maxResponseLength: 500,
        includeEmojis: true,
      },
      fallbackResponse: 'I apologize, but I didn\'t understand that. Could you please rephrase your question?',
      welcomeMessage: `Hello! I'm ${config.name}. How can I help you today?`,
      created: new Date(),
    };
  }

  /**
   * Setup integration details
   */
  private setupIntegration(config: ChatbotConfig): any {
    return {
      webhookUrl: config.webhookUrl || `${this.configService.get('APP_URL')}/api/chatbot/webhook`,
      apiEndpoint: `${this.configService.get('APP_URL')}/api/chatbot/message`,
      documentation: `${this.configService.get('APP_URL')}/docs/chatbot-api`,
      supportedPlatforms: ['website', 'facebook', 'telegram', 'whatsapp', 'slack'],
    };
  }

  /**
   * Generate mock response
   */
  private async generateMockResponse(message: string, context: ConversationContext): Promise<any> {
    const responses = [
      'I understand you\'re asking about that. Let me help you with that information.',
      'That\'s a great question! Here\'s what I can tell you...',
      'I\'d be happy to help you with that. Based on what you\'ve said...',
      'Thank you for reaching out. Here\'s some information that might help...',
      'I can definitely assist you with that. Let me provide some details...',
    ];

    const response = responses[Math.floor(Math.random() * responses.length)];
    const intent = this.detectIntent(message);
    const confidence = Math.random() * 0.3 + 0.7; // 70-100% confidence

    return {
      response,
      intent,
      confidence,
      metadata: {
        processingTime: Math.random() * 1000 + 200, // 200-1200ms
        model: 'mock-gpt-4',
        tokensUsed: Math.floor(Math.random() * 100) + 50,
      },
    };
  }

  /**
   * Build system prompt for OpenAI based on chatbot configuration
   * Enhanced for 24/7 support and improvement-focused interactions
   */
  private buildSystemPrompt(chatbot: any, context: ConversationContext, detectedLanguage?: string): string {
    const settings = chatbot.settings || {};
    const personality = settings.personality || 'friendly';
    const chatbotLanguage = settings.language || 'en';
    
    // Get language priority: detectedLanguage > multilingualConfig.defaultLanguage > chatbot.language > 'en'
    let language = detectedLanguage;
    if (!language) {
      if (settings.multilingualConfig?.enabled) {
        language = settings.multilingualConfig.defaultLanguage || chatbotLanguage;
      } else {
        // If multilingual is not enabled, always use chatbot's configured language
        language = chatbotLanguage;
      }
    }
    const capabilities = settings.capabilities || ['general_chat'];
    
    // Map language codes to full language names
    const languageMap: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'nl': 'Dutch',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'ko': 'Korean',
      'ar': 'Arabic',
    };
    
    const languageName = language ? (languageMap[language] || language) : 'English';
    
    let systemPrompt = `You are ${chatbot.name}, an AI assistant designed for 24/7 client support and engagement. `;
    
    if (chatbot.description) {
      systemPrompt += `${chatbot.description} `;
    }
    
    // Enhanced personality instructions with support focus
    switch (personality) {
      case 'professional':
        systemPrompt += 'Maintain a professional, formal tone in all interactions. Be helpful, empathetic, and solution-oriented. ';
        break;
      case 'friendly':
        systemPrompt += 'Be warm, approachable, and conversational. Show genuine interest in helping clients succeed. ';
        break;
      case 'casual':
        systemPrompt += 'Use a relaxed, informal tone while remaining helpful and supportive. ';
        break;
      case 'expert':
        systemPrompt += 'Demonstrate expertise and provide detailed, technical information. Be proactive in suggesting improvements and optimizations. ';
        break;
    }
    
    // Add 24/7 support emphasis
    systemPrompt += 'You are available 24/7 to help clients with their questions, concerns, and needs. Always be ready to assist, regardless of the time or topic. ';
    
    // Add capability instructions
    if (capabilities.includes('faq')) {
      systemPrompt += 'You can answer frequently asked questions accurately and comprehensively. ';
    }
    if (capabilities.includes('booking')) {
      systemPrompt += 'You can help with scheduling and booking appointments. ';
    }
    if (capabilities.includes('support')) {
      systemPrompt += 'You excel at providing customer support and troubleshooting. When clients face issues, be empathetic and solution-focused. ';
    }
    if (capabilities.includes('upselling')) {
      systemPrompt += 'You can suggest relevant products and services when appropriate, always focusing on client value. ';
    }
    
    // Add improvement-focused instructions
    systemPrompt += 'Be proactive in suggesting improvements and optimizations. When appropriate, offer constructive suggestions that can help clients achieve their goals more effectively. ';
    systemPrompt += 'Listen carefully to client needs and identify opportunities to provide value beyond just answering questions. ';
    
    // Add language instruction - CRITICAL: Always respond in the selected language
    if (language && language !== 'en') {
      systemPrompt += `CRITICAL LANGUAGE REQUIREMENT: You MUST respond EXCLUSIVELY in ${languageName} (${language}). Every single word, sentence, response, explanation, and suggestion MUST be written in ${languageName}. Do NOT use English or mix languages. If the user writes in ${languageName}, respond in ${languageName}. If the user writes in another language, still respond in ${languageName}. Always use ${languageName} for ALL your communications. `;
    } else {
      systemPrompt += 'Respond in English. ';
    }
    
    systemPrompt += 'Keep responses concise but comprehensive. If you cannot fully answer a question, acknowledge it honestly and either provide what you can or offer to connect them with a human representative. Always maintain a positive, supportive attitude.';
    
    return systemPrompt;
  }

  /**
   * Detect intent from message
   */
  private detectIntent(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('price') || lowerMessage.includes('cost')) return 'pricing';
    if (lowerMessage.includes('help') || lowerMessage.includes('support')) return 'support';
    if (lowerMessage.includes('book') || lowerMessage.includes('schedule')) return 'booking';
    if (lowerMessage.includes('contact') || lowerMessage.includes('phone')) return 'contact';
    if (lowerMessage.includes('service') || lowerMessage.includes('product')) return 'product_info';
    
    return 'general_inquiry';
  }

  /**
   * Save conversation to database
   */
  private async saveConversation(
    chatbotId: string,
    sessionId: string,
    userMessage: string,
    botResponse: string,
    intent?: string,
    confidence?: number,
  ): Promise<void> {
    try {
      await this.prisma.conversation.create({
        data: {
          chatbotId,
          sessionId,
          userMessage,
          botResponse,
          intent,
          confidence,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to save conversation: ${msg}`);
    }
  }

  /**
   * Calculate chatbot analytics
   */
  private calculateChatbotAnalytics(conversations: any[]): any {
    const totalConversations = conversations.length;
    const totalMessages = conversations.length * 2; // user + bot messages
    
    const intents = conversations.reduce((acc: Record<string, number>, conv: any) => {
      if (conv.intent) {
        acc[conv.intent] = (acc[conv.intent] || 0) + 1;
      }
      return acc;
    }, {});

    const avgConfidence = conversations.reduce((sum: number, conv: any) => sum + (conv.confidence || 0), 0) / totalConversations;

    return {
      totalConversations,
      totalMessages,
      averageConfidence: avgConfidence,
      intentDistribution: intents,
      topIntents: Object.entries(intents)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 5),
      responseTime: {
        average: Math.random() * 1000 + 500, // 500-1500ms
        median: Math.random() * 800 + 400,
      },
      satisfactionScore: Math.random() * 2 + 3, // 3-5 out of 5
    };
  }

  /**
   * Generate mock training result
   */
  private generateMockTrainingResult(trainingData: any[]): any {
    return {
      success: true,
      settings: {
        modelVersion: '1.1.0',
        trainingAccuracy: Math.random() * 0.2 + 0.8, // 80-100%
        examplesProcessed: trainingData.length,
      },
      metrics: {
        loss: Math.random() * 0.1 + 0.05,
        accuracy: Math.random() * 0.15 + 0.85,
        precision: Math.random() * 0.1 + 0.9,
        recall: Math.random() * 0.1 + 0.9,
      },
    };
  }

  /**
   * Generate mock deployment
   */
  private generateMockDeployment(platform: string): any {
    return {
      platform,
      status: 'deployed',
      deploymentId: `deploy_${Date.now()}`,
      url: `https://${platform}.example.com/chatbot`,
      healthCheck: 'healthy',
      lastDeployed: new Date(),
    };
  }

  /**
   * Save chatbot to database
   */
  async saveChatbotToDatabase(
    userId: string,
    clientId: string | undefined,
    campaignId: string | undefined,
    config: any,
    result: ChatbotResponse
  ): Promise<any> {
    try {
      // Validate and sanitize clientId
      // Only use clientId if it's a non-empty string, otherwise set to null
      let validClientId: string | null = null;
      
      if (clientId && typeof clientId === 'string' && clientId.trim() !== '') {
        // Check if client exists in database
        const client = await this.prisma.client.findUnique({
          where: { id: clientId }
        });
        
        if (client && client.userId === userId) {
          // Client exists and belongs to the user
          validClientId = clientId;
          this.logger.log(`Associating chatbot with client: ${clientId}`);
        } else if (client) {
          // Client exists but doesn't belong to user
          this.logger.warn(`Client ${clientId} exists but doesn't belong to user ${userId}. Creating chatbot without client association.`);
        } else {
          // Client doesn't exist
          this.logger.warn(`Client with ID ${clientId} not found. Creating chatbot without client association.`);
        }
      }

      // Validate and sanitize campaignId
      let validCampaignId: string | null = null;
      
      if (campaignId && typeof campaignId === 'string' && campaignId.trim() !== '') {
        // Check if campaign exists and belongs to the user
        const campaign = await this.prisma.campaign.findUnique({
          where: { id: campaignId }
        });
        
        if (campaign && campaign.userId === userId) {
          validCampaignId = campaignId;
          this.logger.log(`Associating chatbot with campaign: ${campaignId}`);
        } else if (campaign) {
          this.logger.warn(`Campaign ${campaignId} exists but doesn't belong to user ${userId}. Creating chatbot without campaign association.`);
        } else {
          this.logger.warn(`Campaign with ID ${campaignId} not found. Creating chatbot without campaign association.`);
        }
      }

      const chatbot = await this.prisma.chatbot.create({
        data: {
          userId,
          clientId: validClientId,
          campaignId: validCampaignId,
          name: config.name,
          description: config.description,
          platform: config.platform,
          webhookUrl: config.webhookUrl,
          apiKey: result.apiKey,
          settings: result.settings,
          status: 'INACTIVE',
        },
        include: {
          campaign: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              conversations: true,
            },
          },
        },
      });

      this.logger.log(`Chatbot created successfully with ID: ${chatbot.id}`);
      
      // If chatbot is linked to an active campaign, automatically generate content
      if (validCampaignId && chatbot.campaign) {
        const campaign = chatbot.campaign;
        
        // Check if campaign is active/running and has description
        if ((campaign.status === 'active' || campaign.status === 'running') && 
            campaign.description && campaign.description.trim() !== '') {
          this.logger.log(`Chatbot ${chatbot.id} created for active campaign ${campaign.id}. Triggering automatic content generation...`);
          
          // Generate content in background (don't block chatbot creation)
          this.generateCampaignContent(userId, campaign.id, campaign).catch((error) => {
            this.logger.error(`Failed to generate campaign content: ${error instanceof Error ? error.message : 'Unknown error'}`);
          });
        } else {
          this.logger.log(`Chatbot ${chatbot.id} created for campaign ${campaign.id}, but campaign is ${campaign.status}. Activate the chatbot to generate content.`);
        }
      }
      
      // Ensure _count exists (should be 0 for new chatbots)
      return {
        ...chatbot,
        _count: chatbot._count || { conversations: 0 }
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save chatbot to database: ${msg}`);
      throw error;
    }
  }

  /**
   * Get chatbot by ID
   */
  async getChatbotById(chatbotId: string): Promise<any> {
    try {
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              conversations: true,
            },
          },
        },
      });

      // Ensure _count exists even if null
      if (chatbot) {
        return {
          ...chatbot,
          _count: chatbot._count || { conversations: 0 }
        };
      }

      return chatbot;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Get all chatbots for a user
   */
  async getUserChatbots(userId: string): Promise<any[]> {
    try {
      const chatbots = await this.prisma.chatbot.findMany({
        where: { userId },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              conversations: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Ensure all chatbots have _count property with default values
      return chatbots.map(chatbot => ({
        ...chatbot,
        _count: chatbot._count || { conversations: 0 }
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get user chatbots: ${msg}`);
      throw error;
    }
  }

  /**
   * Find FAQ match for user message
   */
  private async findFAQMatch(message: string, faqData?: FAQItem[]): Promise<FAQItem | null> {
    if (!faqData || faqData.length === 0) return null;

    const lowerMessage = message.toLowerCase();
    
    // Find best match based on keywords and priority
    let bestMatch: FAQItem | null = null;
    let bestScore = 0;

    for (const faq of faqData) {
      let score = 0;
      
      // Check keywords
      for (const keyword of faq.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }
      
      // Check question similarity
      const questionWords = faq.question.toLowerCase().split(' ');
      for (const word of questionWords) {
        if (lowerMessage.includes(word) && word.length > 3) {
          score += 0.5;
        }
      }
      
      // Apply priority multiplier
      score *= (faq.priority / 10);
      
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = faq;
      }
    }

    return bestMatch;
  }

  /**
   * Handle booking requests
   */
  private async handleBookingRequest(
    message: string, 
    bookingConfig: BookingConfig, 
    language: string
  ): Promise<any> {
    if (!bookingConfig.enabled) return null;

    const lowerMessage = message.toLowerCase();
    
    // Check if message contains booking-related keywords
    const bookingKeywords = ['book', 'schedule', 'appointment', 'meeting', 'consultation', 'reserve'];
    const hasBookingIntent = bookingKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (!hasBookingIntent) return null;

    // Find mentioned service
    let mentionedService = null;
    for (const service of bookingConfig.services) {
      if (lowerMessage.includes(service.name.toLowerCase())) {
        mentionedService = service;
        break;
      }
    }

    // Generate booking response
    let response = this.getLocalizedMessage('booking_intro', language);
    
    if (mentionedService) {
      response += `\n\n${this.getLocalizedMessage('service_found', language)}: ${mentionedService.name}`;
      response += `\n${this.getLocalizedMessage('duration', language)}: ${mentionedService.duration} ${this.getLocalizedMessage('minutes', language)}`;
      if (mentionedService.price) {
        response += `\n${this.getLocalizedMessage('price', language)}: $${mentionedService.price}`;
      }
    }

    response += `\n\n${this.getLocalizedMessage('booking_options', language)}:`;
    response += `\n1. ${this.getLocalizedMessage('view_availability', language)}`;
    response += `\n2. ${this.getLocalizedMessage('book_now', language)}`;
    
    if (bookingConfig.bookingUrl) {
      response += `\n\n${this.getLocalizedMessage('book_online', language)}: ${bookingConfig.bookingUrl}`;
    }

    return {
      response,
      intent: 'booking',
      confidence: 0.9,
      metadata: {
        service: mentionedService,
        bookingConfig: true,
        processingTime: Date.now(),
        model: 'booking-handler',
        tokensUsed: 0,
        cost: 0,
      },
    };
  }

  /**
   * Find upselling opportunities
   */
  private async findUpsellingOpportunities(
    message: string, 
    upsellingConfig?: UpsellingConfig, 
    context?: ConversationContext
  ): Promise<UpsellingProduct[]> {
    if (!upsellingConfig?.enabled || !upsellingConfig.products) return [];

    const lowerMessage = message.toLowerCase();
    const suggestions: UpsellingProduct[] = [];
    
    // Check for trigger words
    const hasTrigger = upsellingConfig.triggers.some(trigger => 
      lowerMessage.includes(trigger.toLowerCase())
    );
    
    if (!hasTrigger) return suggestions;

    // Find relevant products based on keywords
    for (const product of upsellingConfig.products) {
      const hasKeyword = product.keywords.some(keyword => 
        lowerMessage.includes(keyword.toLowerCase())
      );
      
      if (hasKeyword && suggestions.length < upsellingConfig.maxSuggestions) {
        suggestions.push(product);
      }
    }

    return suggestions;
  }

  /**
   * Format upselling suggestions
   */
  private formatUpsellingSuggestions(suggestions: UpsellingProduct[], language: string): string {
    if (suggestions.length === 0) return '';

    let response = `\n${this.getLocalizedMessage('recommended_products', language)}:\n`;
    
    suggestions.forEach((product, index) => {
      response += `\n${index + 1}. **${product.name}** - $${product.price}`;
      response += `\n   ${product.description}`;
    });

    return response;
  }

  /**
   * Get language name from language code
   */
  private getLanguageName(languageCode: string): string {
    const languageMap: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'nl': 'Dutch',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'ko': 'Korean',
      'ar': 'Arabic',
    };
    return languageMap[languageCode] || languageCode;
  }

  /**
   * Detect language from message
   */
  private detectLanguage(message: string, multilingualConfig?: MultilingualConfig, chatbotLanguage?: string): string {
    // If multilingual is not enabled, use chatbot's default language
    if (!multilingualConfig?.enabled) {
      return chatbotLanguage || 'en';
    }
    
    // If auto-detect is disabled, use default language from multilingual config
    if (!multilingualConfig.autoDetect) {
      return multilingualConfig.defaultLanguage || chatbotLanguage || 'en';
    }

    // Simple language detection based on common words
    const languagePatterns = {
      'es': ['hola', 'gracias', 'por favor', 'sí', 'no', 'cómo', 'qué', 'dónde'],
      'fr': ['bonjour', 'merci', 's\'il vous plaît', 'oui', 'non', 'comment', 'que', 'où'],
      'de': ['hallo', 'danke', 'bitte', 'ja', 'nein', 'wie', 'was', 'wo'],
      'it': ['ciao', 'grazie', 'per favore', 'sì', 'no', 'come', 'cosa', 'dove'],
      'pt': ['olá', 'obrigado', 'por favor', 'sim', 'não', 'como', 'o que', 'onde'],
    };

    const lowerMessage = message.toLowerCase();
    
    for (const [lang, patterns] of Object.entries(languagePatterns)) {
      const matches = patterns.filter(pattern => lowerMessage.includes(pattern));
      if (matches.length >= 2) {
        return lang;
      }
    }

    return multilingualConfig.defaultLanguage || 'en';
  }

  /**
   * Get localized message
   */
  private getLocalizedMessage(key: string, language: string): string {
    const messages: Record<string, Record<string, string>> = {
      booking_intro: {
        en: 'I can help you book an appointment!',
        es: '¡Puedo ayudarte a reservar una cita!',
        fr: 'Je peux vous aider à réserver un rendez-vous!',
        de: 'Ich kann Ihnen bei der Terminbuchung helfen!',
        it: 'Posso aiutarti a prenotare un appuntamento!',
        pt: 'Posso ajudá-lo a marcar uma consulta!',
      },
      service_found: {
        en: 'Service found',
        es: 'Servicio encontrado',
        fr: 'Service trouvé',
        de: 'Service gefunden',
        it: 'Servizio trovato',
        pt: 'Serviço encontrado',
      },
      duration: {
        en: 'Duration',
        es: 'Duración',
        fr: 'Durée',
        de: 'Dauer',
        it: 'Durata',
        pt: 'Duração',
      },
      minutes: {
        en: 'minutes',
        es: 'minutos',
        fr: 'minutes',
        de: 'Minuten',
        it: 'minuti',
        pt: 'minutos',
      },
      price: {
        en: 'Price',
        es: 'Precio',
        fr: 'Prix',
        de: 'Preis',
        it: 'Prezzo',
        pt: 'Preço',
      },
      booking_options: {
        en: 'Booking options',
        es: 'Opciones de reserva',
        fr: 'Options de réservation',
        de: 'Buchungsoptionen',
        it: 'Opzioni di prenotazione',
        pt: 'Opções de reserva',
      },
      view_availability: {
        en: 'View available times',
        es: 'Ver horarios disponibles',
        fr: 'Voir les créneaux disponibles',
        de: 'Verfügbare Zeiten anzeigen',
        it: 'Visualizza orari disponibili',
        pt: 'Ver horários disponíveis',
      },
      book_now: {
        en: 'Book now',
        es: 'Reservar ahora',
        fr: 'Réserver maintenant',
        de: 'Jetzt buchen',
        it: 'Prenota ora',
        pt: 'Reservar agora',
      },
      book_online: {
        en: 'Book online',
        es: 'Reservar en línea',
        fr: 'Réserver en ligne',
        de: 'Online buchen',
        it: 'Prenota online',
        pt: 'Reservar online',
      },
      recommended_products: {
        en: 'Recommended for you',
        es: 'Recomendado para ti',
        fr: 'Recommandé pour vous',
        de: 'Empfohlen für Sie',
        it: 'Consigliato per te',
        pt: 'Recomendado para você',
      },
    };

    return messages[key]?.[language] || messages[key]?.['en'] || key;
  }

  /**
   * Add FAQ data to chatbot
   */
  async addFAQData(chatbotId: string, faqData: FAQItem[]): Promise<any> {
    try {
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
      });

      if (!chatbot) {
        throw new Error(`Chatbot with ID ${chatbotId} not found`);
      }

      const settings = chatbot.settings as any || {};
      settings.faqData = faqData;

      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: { settings },
      });

      return {
        success: true,
        data: { faqCount: faqData.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to add FAQ data: ${msg}`);
      throw error;
    }
  }

  /**
   * Update booking configuration
   */
  async updateBookingConfig(chatbotId: string, bookingConfig: BookingConfig): Promise<any> {
    try {
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
      });

      if (!chatbot) {
        throw new Error(`Chatbot with ID ${chatbotId} not found`);
      }

      const settings = chatbot.settings as any || {};
      settings.bookingConfig = bookingConfig;

      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: { settings },
      });

      return {
        success: true,
        data: bookingConfig,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update booking config: ${msg}`);
      throw error;
    }
  }

  /**
   * Update upselling configuration
   */
  async updateUpsellingConfig(chatbotId: string, upsellingConfig: UpsellingConfig): Promise<any> {
    try {
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
      });

      if (!chatbot) {
        throw new Error(`Chatbot with ID ${chatbotId} not found`);
      }

      const settings = chatbot.settings as any || {};
      settings.upsellingConfig = upsellingConfig;

      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: { settings },
      });

      return {
        success: true,
        data: upsellingConfig,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update upselling config: ${msg}`);
      throw error;
    }
  }

  /**
   * Update multilingual configuration
   */
  async updateMultilingualConfig(chatbotId: string, multilingualConfig: MultilingualConfig): Promise<any> {
    try {
      const chatbot = await this.prisma.chatbot.findUnique({
        where: { id: chatbotId },
      });

      if (!chatbot) {
        throw new Error(`Chatbot with ID ${chatbotId} not found`);
      }

      const settings = chatbot.settings as any || {};
      settings.multilingualConfig = multilingualConfig;

      await this.prisma.chatbot.update({
        where: { id: chatbotId },
        data: { settings },
      });

      return {
        success: true,
        data: multilingualConfig,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update multilingual config: ${msg}`);
      throw error;
    }
  }

  /**
   * Delete a chatbot
   */
  async deleteChatbot(chatbotId: string): Promise<any> {
    try {
      this.logger.log(`Deleting chatbot: ${chatbotId}`);

      // First, delete all related conversations
      await this.prisma.conversation.deleteMany({
        where: { chatbotId },
      });

      this.logger.log(`Deleted conversations for chatbot: ${chatbotId}`);

      // Then delete the chatbot
      const chatbot = await this.prisma.chatbot.delete({
        where: { id: chatbotId },
      });

      this.logger.log(`Chatbot deleted successfully: ${chatbotId}`);
      return chatbot;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete chatbot: ${msg}`);
      throw error;
    }
  }

  /**
   * Get improvement suggestions for a chatbot
   */
  async getImprovementSuggestions(chatbotId: string, days: number = 7): Promise<any> {
    try {
      return await this.improvementSuggestionService.analyzeAndSuggestImprovements(chatbotId, days);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get improvement suggestions: ${msg}`);
      throw error;
    }
  }

  /**
   * Process message from public API (API key based, for client-facing interactions)
   */
  async processPublicMessage(
    apiKey: string,
    message: string,
    context: ConversationContext,
  ): Promise<any> {
    try {
      this.logger.log(`Processing public message with API key: ${apiKey.substring(0, 10)}...`);

      // Find chatbot by API key
      const chatbot = await this.prisma.chatbot.findFirst({
        where: { apiKey, status: 'ACTIVE' },
      });

      if (!chatbot) {
        throw new Error('Invalid API key or chatbot not active');
      }

      // Process message using the chatbot
      return await this.processMessage(chatbot.id, message, context);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process public message: ${msg}`);
      throw error;
    }
  }
}