import { 
  Controller, 
  Post, 
  Get, 
  Delete,
  Body, 
  Param, 
  Query, 
  UseGuards, 
  Request,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
  Logger
} from '@nestjs/common';
import { ChatbotService, ConversationContext } from './chatbot.service';
import { CostMonitoringService } from './cost-monitoring.service';
import { AuthGuard } from '../../auth/auth.guard';
import { ProcessMessageDto } from './dto/process-message.dto';
import { CreateChatbotDto } from '../dto/create-chatbot.dto';
import { TrainChatbotDto } from './dto/train-chatbot.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
    role: string;
  };
}

@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger('ChatbotController');

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly costMonitoringService: CostMonitoringService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new chatbot
   */
  @Post('create')
  @UseGuards(AuthGuard)
  async createChatbot(@Request() req: AuthenticatedRequest, @Body() body: CreateChatbotDto) {
    try {
      const result = await this.chatbotService.createChatbot({
        name: body.name,
        description: body.description,
        platform: body.platform,
        webhookUrl: body.webhookUrl,
        personality: body.personality,
        language: body.language,
        capabilities: body.capabilities,
        trainingData: body.trainingData,
      });

      // Save chatbot to database
      const savedChatbot = await this.chatbotService.saveChatbotToDatabase(
        req.user.sub,
        body.clientId,
        body.campaignId,
        body,
        result
      );

      return {
        success: true,
        data: {
          ...savedChatbot,
          integration: result.integration,
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to create chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Process a message through a chatbot
   */
  @Post(':id/message')
  @UseGuards(AuthGuard)
  async processMessage(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: ProcessMessageDto
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const context: ConversationContext = {
        sessionId: body.sessionId,
        userId: req.user.sub,
        previousMessages: body.previousMessages || [],
        intent: body.intent,
        entities: body.entities,
      };

      const response = await this.chatbotService.processMessage(
        chatbotId,
        body.message,
        context
      );

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Train a chatbot with custom data
   */
  @Post(':id/train')
  @UseGuards(AuthGuard)
  async trainChatbot(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: TrainChatbotDto
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.trainChatbot(chatbotId, body.trainingData);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to train chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get chatbot conversation history
   */
  @Get(':id/conversations')
  @UseGuards(AuthGuard)
  async getConversationHistory(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.getConversationHistory(
        chatbotId,
        sessionId,
        limit ? parseInt(limit) : 50
      );

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to get conversation history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get chatbot analytics
   */
  @Get(':id/analytics')
  @UseGuards(AuthGuard)
  async getChatbotAnalytics(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const dateRange = startDate && endDate ? {
        start: new Date(startDate),
        end: new Date(endDate),
      } : undefined;

      const result = await this.chatbotService.analyzePerformance(chatbotId, dateRange);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to get analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Update chatbot settings
   */
  @Post(':id/settings')
  @UseGuards(AuthGuard)
  async updateChatbotSettings(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: any
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.updateChatbotSettings(chatbotId, body);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to update settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Activate chatbot
   */
  @Post(':id/activate')
  @UseGuards(AuthGuard)
  async activateChatbot(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.activateChatbot(chatbotId);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to activate chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Deploy chatbot to platform
   */
  @Post(':id/deploy')
  @UseGuards(AuthGuard)
  async deployChatbot(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: { platform: string }
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.deployChatbot(chatbotId, body.platform);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to deploy chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Generate campaign content (images, blog, SEO, social posts)
   */
  @Post('generate-campaign-content')
  @UseGuards(AuthGuard)
  async generateCampaignContent(
    @Request() req: AuthenticatedRequest,
    @Body() body: { campaignId: string }
  ) {
    try {
      const { campaignId } = body;
      if (!campaignId) {
        throw new HttpException('Campaign ID is required', HttpStatus.BAD_REQUEST);
      }

      // Get campaign details
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new HttpException('Campaign not found', HttpStatus.NOT_FOUND);
      }

      // Verify campaign belongs to user
      if (campaign.userId !== req.user.sub) {
        throw new HttpException('Campaign access denied', HttpStatus.FORBIDDEN);
      }

      // Validate campaign has required data for content generation
      const settings = (campaign.settings as Record<string, any>) || {};
      const campaignDescription = campaign.description || '';
      const businessProfile = settings.businessProfile || {};
      const businessContext = businessProfile.primaryProductOrService || businessProfile.companyName || '';
      const campaignName = campaign.name || '';

      // Check if campaign has any content to generate from
      if (!campaignDescription && !businessContext && !campaignName) {
        throw new HttpException(
          'Campaign description is required for automatic content generation. Please add a description to the campaign and try again.',
          HttpStatus.BAD_REQUEST
        );
      }

      // Check if OpenAI API key is configured for image generation
      const openaiApiKey = this.configService?.get<string>('OPENAI_API_KEY');
      if (!openaiApiKey || openaiApiKey === 'your-openai-api-key-here' || !openaiApiKey.trim() || !openaiApiKey.startsWith('sk-')) {
        this.logger.warn('OpenAI API key not configured. Image generation will use mock images.');
        // Continue with generation but log warning - mock images will be generated
      }

      // Generate content for the campaign in background (don't block response)
      this.chatbotService.generateCampaignContent(
        req.user.sub,
        campaignId,
        campaign
      ).catch((error) => {
        // Log error with full details for debugging
        const logger = new Logger('ChatbotController');
        logger.error(
          `Background content generation failed for campaign ${campaignId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error instanceof Error ? error.stack : ''
        );
      });

      return {
        success: true,
        message: 'Campaign content generation started. Images, blog posts, SEO content, and social media posts will be generated.',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to generate campaign content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all chatbots for a user
   */
  @Get()
  @UseGuards(AuthGuard)
  async getUserChatbots(@Request() req: AuthenticatedRequest) {
    try {
      const chatbots = await this.chatbotService.getUserChatbots(req.user.sub);

      return {
        success: true,
        data: chatbots,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get chatbots: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get chatbot by ID
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async getChatbot(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string
  ) {
    try {
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      return {
        success: true,
        data: chatbot,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Add FAQ data to chatbot
   */
  @Post(':id/faq')
  @UseGuards(AuthGuard)
  async addFAQData(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: { faqData: any[] }
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.addFAQData(chatbotId, body.faqData);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to add FAQ data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Update booking configuration
   */
  @Post(':id/booking-config')
  @UseGuards(AuthGuard)
  async updateBookingConfig(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: any
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.updateBookingConfig(chatbotId, body);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to update booking config: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Update upselling configuration
   */
  @Post(':id/upselling-config')
  @UseGuards(AuthGuard)
  async updateUpsellingConfig(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: any
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.updateUpsellingConfig(chatbotId, body);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to update upselling config: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Update multilingual configuration
   */
  @Post(':id/multilingual-config')
  @UseGuards(AuthGuard)
  async updateMultilingualConfig(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Body() body: any
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.updateMultilingualConfig(chatbotId, body);

      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to update multilingual config: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get user's cost summary
   */
  @Get('cost-summary')
  @UseGuards(AuthGuard)
  async getUserCostSummary(
    @Request() req: AuthenticatedRequest,
    @Query('period') period?: 'day' | 'week' | 'month'
  ) {
    try {
      const result = await this.costMonitoringService.getUserCostSummary(
        req.user.sub,
        period || 'month'
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get cost summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all users cost summary (admin only)
   */
  @Get('admin/cost-summary')
  @UseGuards(AuthGuard)
  async getAllUsersCostSummary(
    @Request() req: AuthenticatedRequest,
    @Query('period') period?: 'day' | 'week' | 'month'
  ) {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
      }

      const result = await this.costMonitoringService.getAllUsersCostSummary(
        period || 'month'
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get all users cost summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get top users by cost (admin only)
   */
  @Get('admin/top-users')
  @UseGuards(AuthGuard)
  async getTopUsersByCost(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('period') period?: 'day' | 'week' | 'month'
  ) {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
      }

      const result = await this.costMonitoringService.getTopUsersByCost(
        limit ? parseInt(limit) : 10,
        period || 'month'
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get top users: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Check users approaching cost limits (admin only)
   */
  @Get('admin/cost-alerts')
  @UseGuards(AuthGuard)
  async getCostAlerts(@Request() req: AuthenticatedRequest) {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
      }

      const result = await this.costMonitoringService.checkUsersApproachingLimits();

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get cost alerts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Delete a chatbot
   */
  @Delete(':id')
  @UseGuards(AuthGuard)
  async deleteChatbot(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const result = await this.chatbotService.deleteChatbot(chatbotId);

      return {
        success: true,
        message: 'Chatbot deleted successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to delete chatbot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get improvement suggestions for a chatbot
   */
  @Get(':id/improvements')
  @UseGuards(AuthGuard)
  async getImprovementSuggestions(
    @Request() req: AuthenticatedRequest,
    @Param('id') chatbotId: string,
    @Query('days') days?: string
  ) {
    try {
      // Verify chatbot ownership
      const chatbot = await this.chatbotService.getChatbotById(chatbotId);
      if (!chatbot || chatbot.userId !== req.user.sub) {
        throw new HttpException('Chatbot not found or access denied', HttpStatus.NOT_FOUND);
      }

      const suggestions = await this.chatbotService.getImprovementSuggestions(
        chatbotId,
        days ? parseInt(days) : 7
      );

      return {
        success: true,
        data: suggestions,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get improvement suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Public endpoint for client-facing chatbot interactions (API key based)
   * This allows clients to interact with the chatbot 24/7 without authentication
   */
  @Post('public/message')
  async processPublicMessage(
    @Headers('x-api-key') apiKey: string,
    @Body() body: ProcessMessageDto
  ) {
    try {
      if (!apiKey) {
        throw new HttpException('API key required. Please provide x-api-key header.', HttpStatus.UNAUTHORIZED);
      }

      const context: ConversationContext = {
        sessionId: body.sessionId,
        previousMessages: body.previousMessages || [],
        intent: body.intent,
        entities: body.entities,
      };

      const response = await this.chatbotService.processPublicMessage(
        apiKey,
        body.message,
        context
      );

      return {
        success: true,
        data: response,
        message: 'Chatbot is available 24/7 to assist you',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
