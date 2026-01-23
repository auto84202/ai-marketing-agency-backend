import { Controller, Post, Get, Put, Delete, Body, Param, Query, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { AIService } from './ai.service';
import { AuthGuard } from '../auth/auth.guard';
import { GenerateContentDto } from './dto/generate-content.dto';
import { GenerateSEODto } from './dto/generate-seo.dto';
import { GenerateSocialDto } from './dto/generate-social.dto';
import { CreateChatbotDto } from './dto/create-chatbot.dto';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
    role: string;
  };
}

@Controller('ai')
@UseGuards(AuthGuard)
export class AIController {
  constructor(private readonly aiService: AIService) {}

  /**
   * Generate AI content
   */
  @Post('content/generate')
  async generateContent(@Request() req: AuthenticatedRequest, @Body() body: GenerateContentDto) {
    return this.aiService.generateContent(req.user.sub, body.type, body.prompt, body);
  }

  /**
   * Generate SEO content
   */
  @Post('seo/generate')
  async generateSEOContent(@Request() req: AuthenticatedRequest, @Body() body: GenerateSEODto) {
    return this.aiService.generateSEOContent(req.user.sub, body.keywords, body.contentType, body);
  }

  /**
   * Generate social media content
   */
  @Post('social/generate')
  async generateSocialContent(@Request() req: AuthenticatedRequest, @Body() body: GenerateSocialDto) {
    return this.aiService.generateSocialContent(req.user.sub, body.platform, body.campaignId, body);
  }

  /**
   * Create AI chatbot
   */
  @Post('chatbot/create')
  async createChatbot(@Request() req: AuthenticatedRequest, @Body() body: CreateChatbotDto) {
    return this.aiService.createChatbot(req.user.sub, body.clientId, {
      name: body.name,
      description: body.description,
      platform: body.platform,
      webhookUrl: body.webhookUrl,
      personality: body.personality,
      language: body.language,
      capabilities: body.capabilities,
      trainingData: body.trainingData,
      ...body.config,
    }, body.campaignId);
  }

  /**
   * Get analytics
   */
  @Get('analytics')
  async getAnalytics(
    @Request() req: AuthenticatedRequest,
    @Query('campaignId') campaignId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const dateRange = startDate && endDate ? {
      start: new Date(startDate),
      end: new Date(endDate),
    } : undefined;

    return this.aiService.getAnalytics(req.user.sub, campaignId, dateRange);
  }

  /**
   * Get usage statistics
   */
  @Get('usage')
  async getUsageStats(
    @Request() req: AuthenticatedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const period = startDate && endDate ? {
      start: new Date(startDate),
      end: new Date(endDate),
    } : undefined;

    return this.aiService.getUsageStats(req.user.sub, period);
  }

  /**
   * Generate blog post content
   */
  @Post('content/blog')
  async generateBlogPost(
    @Request() req: AuthenticatedRequest,
    @Body() body: { topic: string; options?: any }
  ) {
    return this.aiService.generateBlogPost(req.user.sub, body.topic, body.options);
  }

  /**
   * Generate ad copy
   */
  @Post('content/ad-copy')
  async generateAdCopy(
    @Request() req: AuthenticatedRequest,
    @Body() body: { product: string; targetAudience: string; options?: any }
  ) {
    return this.aiService.generateAdCopy(req.user.sub, body.product, body.targetAudience, body.options);
  }

  /**
   * Generate email content
   */
  @Post('content/email')
  async generateEmailContent(
    @Request() req: AuthenticatedRequest,
    @Body() body: { purpose: string; recipient: string; options?: any }
  ) {
    return this.aiService.generateEmailContent(req.user.sub, body.purpose, body.recipient, body.options);
  }

  /**
   * Generate product description
   */
  @Post('content/product-description')
  async generateProductDescription(
    @Request() req: AuthenticatedRequest,
    @Body() body: { productName: string; features: string[]; options?: any }
  ) {
    return this.aiService.generateProductDescription(req.user.sub, body.productName, body.features, body.options);
  }

  /**
   * Generate video script
   */
  @Post('content/video-script')
  async generateVideoScript(
    @Request() req: AuthenticatedRequest,
    @Body() body: { topic: string; duration: number; options?: any }
  ) {
    return this.aiService.generateVideoScript(req.user.sub, body.topic, body.duration, body.options);
  }

  /**
   * Generate social media captions
   */
  @Post('content/captions')
  async generateCaptions(
    @Request() req: AuthenticatedRequest,
    @Body() body: { platform: string; content: string; options?: any }
  ) {
    return this.aiService.generateCaptions(req.user.sub, body.platform, body.content, body.options);
  }

  /**
   * Generate headlines
   */
  @Post('content/headlines')
  async generateHeadlines(
    @Request() req: AuthenticatedRequest,
    @Body() body: { topic: string; count?: number; options?: any }
  ) {
    return this.aiService.generateHeadlines(req.user.sub, body.topic, body.count || 5, body.options);
  }

  /**
   * Get user's generated content
   */
  @Get('content')
  async getUserContent(
    @Request() req: AuthenticatedRequest,
    @Query('type') type?: string,
    @Query('campaignId') campaignId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      // Parse and validate limit (max 1000 to prevent performance issues)
      const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 10, 1), 1000) : 10;
      const offsetNum = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;
      
      return await this.aiService.getUserContent(req.user.sub, type, limitNum, offsetNum, campaignId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        `Failed to get user content: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get specific content by ID
   */
  @Get('content/:id')
  async getContentById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.aiService.getContentById(req.user.sub, id);
  }

  /**
   * Update content
   */
  @Put('content/:id')
  async updateContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; metadata?: any }
  ) {
    return this.aiService.updateContent(req.user.sub, id, body);
  }

  /**
   * Delete content
   */
  @Delete('content/:id')
  async deleteContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.aiService.deleteContent(req.user.sub, id);
  }

  /**
   * Get all content templates
   */
  @Get('templates')
  async getTemplates(
    @Query('type') type?: string,
    @Query('industry') industry?: string,
    @Query('search') search?: string,
  ) {
    return this.aiService.getTemplates(type, industry, search);
  }

  /**
   * Get specific template by ID
   */
  @Get('templates/:id')
  async getTemplateById(@Param('id') id: string) {
    return this.aiService.getTemplateById(id);
  }

  /**
   * Get industry presets
   */
  @Get('templates/presets')
  async getIndustryPresets() {
    return this.aiService.getIndustryPresets();
  }

  /**
   * Generate content using template
   */
  @Post('templates/:id/generate')
  async generateFromTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { variables: Record<string, string>; options?: any }
  ) {
    return this.aiService.generateFromTemplate(req.user.sub, id, body.variables, body.options);
  }

  /**
   * Get recommended templates
   */
  @Get('templates/recommended')
  async getRecommendedTemplates(
    @Query('type') type: string,
    @Query('industry') industry?: string,
    @Query('tags') tags?: string,
  ) {
    const tagArray = tags ? tags.split(',') : undefined;
    return this.aiService.getRecommendedTemplates(type, industry, tagArray);
  }

  /**
   * Create a new version of content
   */
  @Post('content/:id/versions')
  async createContentVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; metadata?: any }
  ) {
    return this.aiService.createContentVersion(req.user.sub, id, body);
  }

  /**
   * Get content version history
   */
  @Get('content/:id/versions')
  async getContentVersions(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.aiService.getContentVersions(req.user.sub, id);
  }

  /**
   * Restore content to a specific version
   */
  @Post('content/:id/versions/:version/restore')
  async restoreContentVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.aiService.restoreContentVersion(req.user.sub, id, parseInt(version));
  }

  /**
   * Compare two content versions
   */
  @Get('content/:id/versions/compare')
  async compareContentVersions(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('v1') version1: string,
    @Query('v2') version2: string,
  ) {
    return this.aiService.compareContentVersions(req.user.sub, id, parseInt(version1), parseInt(version2));
  }

  /**
   * Generate multiple pieces of content in batch
   */
  @Post('content/batch')
  async generateBatchContent(
    @Request() req: AuthenticatedRequest,
    @Body() body: {
      requests: Array<{
        type: string;
        prompt: string;
        options?: any;
        title?: string;
      }>;
    }
  ) {
    return this.aiService.generateBatchContent(req.user.sub, body.requests);
  }

  /**
   * Generate content variations
   */
  @Post('content/variations')
  async generateContentVariations(
    @Request() req: AuthenticatedRequest,
    @Body() body: {
      baseContent: {
        type: string;
        prompt: string;
        options?: any;
      };
      variations: Array<{
        name: string;
        modifications: {
          tone?: string;
          length?: string;
          style?: string;
          targetAudience?: string;
        };
      }>;
    }
  ) {
    return this.aiService.generateContentVariations(req.user.sub, body.baseContent, body.variations);
  }

  /**
   * Submit content for approval
   */
  @Post('content/:id/approval/submit')
  async submitForApproval(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.aiService.submitForApproval(req.user.sub, id);
  }

  /**
   * Approve content
   */
  @Post('content/:id/approval/approve')
  async approveContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { notes?: string }
  ) {
    return this.aiService.approveContent(req.user.sub, id, body.notes);
  }

  /**
   * Reject content
   */
  @Post('content/:id/approval/reject')
  async rejectContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { reason: string; notes?: string }
  ) {
    return this.aiService.rejectContent(req.user.sub, id, body.reason, body.notes);
  }

  /**
   * Request content revision
   */
  @Post('content/:id/approval/request-revision')
  async requestRevision(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { reason: string; notes?: string }
  ) {
    return this.aiService.requestRevision(req.user.sub, id, body.reason, body.notes);
  }

  /**
   * Get content pending approval
   */
  @Get('content/approval/pending')
  async getPendingApproval(
    @Request() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
  ) {
    // SECURITY: Only allow admins to query other users' content
    // Regular users can only see their own pending approval content
    const isAdmin = req.user.role === 'ADMIN';
    const authenticatedUserId = req.user.sub;
    const targetUserId = isAdmin && userId ? userId : authenticatedUserId;
    return this.aiService.getPendingApproval(targetUserId);
  }

  /**
   * Get content approval history
   */
  @Get('content/approval/history')
  async getApprovalHistory(
    @Request() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    // SECURITY: Only allow admins to query other users' content
    // Regular users can only see their own approval history
    const isAdmin = req.user.role === 'ADMIN';
    const authenticatedUserId = req.user.sub;
    const targetUserId = isAdmin && userId ? userId : authenticatedUserId;
    return this.aiService.getApprovalHistory(targetUserId, status);
  }
}