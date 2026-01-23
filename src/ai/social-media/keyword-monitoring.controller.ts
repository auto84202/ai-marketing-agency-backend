import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { KeywordMonitoringService } from './keyword-monitoring.service';
import { AutomatedEngagementService, EngagementConfig } from './automated-engagement.service';

@Controller('api/keyword-monitoring')
@UseGuards(AuthGuard)
export class KeywordMonitoringController {
  constructor(
    private readonly keywordMonitoringService: KeywordMonitoringService,
    private readonly automatedEngagementService: AutomatedEngagementService,
  ) {}

  /**
   * Create a new keyword monitoring campaign
   */
  @Post('campaigns')
  async createCampaign(
    @Request() req: any,
    @Body()
    body: {
      businessName: string;
      businessDescription: string;
      keywords: string[];
      platforms?: string[];
    },
  ) {
    try {
      const userId = req.user.sub;
      const { businessName, businessDescription, keywords, platforms } = body;

      if (!businessName || !businessDescription || !keywords || keywords.length === 0) {
        throw new HttpException(
          'Business name, description, and keywords are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const campaign = await this.keywordMonitoringService.createCampaign(
        userId,
        businessName,
        businessDescription,
        keywords,
        platforms,
      );

      return {
        success: true,
        message: 'Campaign created successfully',
        data: campaign,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all campaigns for the authenticated user
   */
  @Get('campaigns')
  async getUserCampaigns(@Request() req: any) {
    try {
      const userId = req.user.sub;
      const campaigns = await this.keywordMonitoringService.getUserCampaigns(userId);

      return {
        success: true,
        data: campaigns,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get campaign details with statistics
   */
  @Get('campaigns/:campaignId')
  async getCampaignDetails(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      const statistics = await this.keywordMonitoringService.getCampaignStatistics(campaignId);

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get campaign statistics (detailed breakdown)
   */
  @Get('campaigns/:campaignId/statistics')
  async getCampaignStatistics(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      const statistics = await this.keywordMonitoringService.getCampaignStatistics(campaignId);

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Manually trigger a scan for specific campaign
   */
  @Post('campaigns/:campaignId/scan')
  async scanCampaign(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      const matches = await this.keywordMonitoringService.scanCampaignKeywords(campaignId);

      return {
        success: true,
        message: `Found ${matches.length} new matches`,
        data: {
          matchesFound: matches.length,
          matches: matches.slice(0, 10), // Return first 10 for preview
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update campaign status (activate/deactivate)
   */
  @Put('campaigns/:campaignId/status')
  async updateCampaignStatus(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
    @Body() body: { isActive: boolean },
  ) {
    try {
      await this.keywordMonitoringService.updateCampaignStatus(campaignId, body.isActive);

      return {
        success: true,
        message: `Campaign ${body.isActive ? 'activated' : 'deactivated'} successfully`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete a campaign
   */
  @Delete('campaigns/:campaignId')
  async deleteCampaign(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      await this.keywordMonitoringService.deleteCampaign(campaignId);

      return {
        success: true,
        message: 'Campaign deleted successfully',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Start automated engagement for a campaign
   */
  @Post('campaigns/:campaignId/engagement/start')
  async startAutomatedEngagement(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
    @Body() body: EngagementConfig,
  ) {
    try {
      const result = await this.automatedEngagementService.startAutomatedEngagement(
        campaignId,
        body,
      );

      return {
        success: true,
        message: result.message,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Stop automated engagement for a campaign
   */
  @Post('campaigns/:campaignId/engagement/stop')
  async stopAutomatedEngagement(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      await this.automatedEngagementService.stopAutomatedEngagement(campaignId);

      return {
        success: true,
        message: 'Automated engagement stopped successfully',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Manually engage with specific pending matches
   */
  @Post('campaigns/:campaignId/engagement/engage-pending')
  async engagePendingMatches(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      const results = await this.automatedEngagementService.engagePendingMatches(campaignId);

      return {
        success: true,
        message: `Engaged with ${results.length} matches`,
        data: {
          totalProcessed: results.length,
          successful: results.filter((r) => r.status === 'SUCCESS').length,
          failed: results.filter((r) => r.status === 'FAILED').length,
          skipped: results.filter((r) => r.status === 'SKIPPED').length,
          results: results.slice(0, 10), // Return first 10 for preview
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get engagement analytics for a campaign
   */
  @Get('campaigns/:campaignId/engagement/analytics')
  async getEngagementAnalytics(@Request() req: any, @Param('campaignId') campaignId: string) {
    try {
      const analytics = await this.automatedEngagementService.getEngagementAnalytics(campaignId);

      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get dashboard overview (all campaigns summary)
   */
  @Get('dashboard')
  async getDashboardOverview(@Request() req: any) {
    try {
      const userId = req.user.sub;
      const campaigns = await this.keywordMonitoringService.getUserCampaigns(userId);

      const overview = {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.isActive).length,
        inactiveCampaigns: campaigns.filter((c) => !c.isActive).length,
        campaignsWithAutoEngagement: campaigns.filter((c: any) => c.autoEngagementEnabled).length,
        recentCampaigns: campaigns.slice(0, 5),
      };

      return {
        success: true,
        data: overview,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

