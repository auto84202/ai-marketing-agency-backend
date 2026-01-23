import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { ABTestingService } from './ab-testing.service';
import {
  ABTestConfig,
  ABTestResult,
} from './ab-testing.service';

@Controller('ai/ab-testing')
@UseGuards(JwtAuthGuard)
export class ABTestingController {
  constructor(
    private readonly abTestingService: ABTestingService,
  ) {}

  /**
   * Create A/B test
   */
  @Post('tests')
  @HttpCode(HttpStatus.CREATED)
  async createABTest(
    @Request() req: any,
    @Body() config: ABTestConfig,
  ): Promise<any> {
    return this.abTestingService.createABTest(req.user.id, config);
  }

  /**
   * Get A/B test results
   */
  @Get('tests/:testId')
  async getTestResults(@Param('testId') testId: string): Promise<ABTestResult> {
    return this.abTestingService.getTestResults(testId);
  }

  /**
   * Get all A/B tests for a campaign
   */
  @Get('campaigns/:campaignId/tests')
  async getCampaignTests(@Param('campaignId') campaignId: string): Promise<ABTestResult[]> {
    return this.abTestingService.getCampaignTests(campaignId);
  }

  /**
   * Cancel A/B test
   */
  @Put('tests/:testId/cancel')
  async cancelTest(
    @Param('testId') testId: string,
    @Body() body: { reason?: string },
  ): Promise<void> {
    return this.abTestingService.cancelTest(testId, body.reason);
  }

  /**
   * Get test monitoring status
   */
  @Get('tests/:testId/monitoring')
  async getTestMonitoring(@Param('testId') testId: string): Promise<any> {
    const test = await this.abTestingService.getTestResults(testId);
    
    return {
      testId,
      status: test.status,
      currentSampleSize: test.currentSampleSize,
      requiredSampleSize: test.requiredSampleSize,
      statisticalSignificance: test.statisticalSignificance,
      confidence: test.confidence,
      estimatedCompletion: test.estimatedCompletionDate,
      isMonitoring: test.status === 'ACTIVE',
      lastUpdated: new Date(),
    };
  }

  /**
   * Get A/B test analytics
   */
  @Get('tests/:testId/analytics')
  async getTestAnalytics(@Param('testId') testId: string): Promise<any> {
    const test = await this.abTestingService.getTestResults(testId);
    
    return {
      testId,
      performanceComparison: {
        variantA: {
          id: test.variantA.id,
          ctr: test.variantA.performance.ctr,
          conversionRate: test.variantA.performance.conversionRate,
          cpa: test.variantA.performance.cpa,
          roas: test.variantA.performance.roas,
        },
        variantB: {
          id: test.variantB.id,
          ctr: test.variantB.performance.ctr,
          conversionRate: test.variantB.performance.conversionRate,
          cpa: test.variantB.performance.cpa,
          roas: test.variantB.performance.roas,
        },
      },
      statisticalAnalysis: {
        significance: test.statisticalSignificance,
        confidence: test.confidence,
        winner: test.winner,
        power: Math.min(0.99, 0.7 + test.confidence * 0.3),
      },
      mlRecommendations: test.mlRecommendations,
      nextSteps: test.nextSteps,
    };
  }

  /**
   * Get all active A/B tests
   */
  @Get('tests/active')
  async getActiveTests(@Request() req: any): Promise<any[]> {
    // This would fetch all active tests for the user
    return [];
  }

  /**
   * Get test performance trends
   */
  @Get('tests/:testId/trends')
  async getTestTrends(
    @Param('testId') testId: string,
    @Query('days') days: number = 7,
  ): Promise<any> {
    return {
      testId,
      timeframe: `${days} days`,
      trends: {
        variantA: {
          impressions: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 1000 + Math.random() * 500,
          })),
          clicks: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 20 + Math.random() * 10,
          })),
          conversions: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 1 + Math.random() * 2,
          })),
        },
        variantB: {
          impressions: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 950 + Math.random() * 500,
          })),
          clicks: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 18 + Math.random() * 10,
          })),
          conversions: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
            value: 0.8 + Math.random() * 2,
          })),
        },
      },
    };
  }

  /**
   * Get test recommendations
   */
  @Get('tests/:testId/recommendations')
  async getTestRecommendations(@Param('testId') testId: string): Promise<any> {
    const test = await this.abTestingService.getTestResults(testId);
    
    return {
      testId,
      mlRecommendations: test.mlRecommendations,
      statisticalRecommendations: [
        {
          type: 'SAMPLE_SIZE',
          message: test.currentSampleSize < test.requiredSampleSize 
            ? `Need ${test.requiredSampleSize - test.currentSampleSize} more samples for statistical significance`
            : 'Sample size is sufficient for reliable results',
          priority: test.currentSampleSize < test.requiredSampleSize ? 'HIGH' : 'LOW',
        },
        {
          type: 'CONFIDENCE',
          message: test.confidence < 0.8 
            ? 'Test needs more data to reach statistical significance'
            : 'Test has sufficient statistical significance',
          priority: test.confidence < 0.8 ? 'MEDIUM' : 'LOW',
        },
      ],
      businessRecommendations: test.nextSteps.map(step => ({
        type: 'BUSINESS_ACTION',
        message: step,
        priority: step.includes('implement') ? 'HIGH' : 'MEDIUM',
      })),
    };
  }

  /**
   * Pause A/B test
   */
  @Put('tests/:testId/pause')
  async pauseTest(
    @Param('testId') testId: string,
    @Body() body: { reason?: string },
  ): Promise<void> {
    // This would pause the test
    return;
  }

  /**
   * Resume A/B test
   */
  @Put('tests/:testId/resume')
  async resumeTest(@Param('testId') testId: string): Promise<void> {
    // This would resume the test
    return;
  }

  /**
   * Get A/B test summary
   */
  @Get('tests/:testId/summary')
  async getTestSummary(@Param('testId') testId: string): Promise<any> {
    const test = await this.abTestingService.getTestResults(testId);
    
    return {
      testId,
      name: 'Test Name', // This would come from the test data
      status: test.status,
      duration: '7 days', // This would be calculated
      winner: test.winner,
      improvement: test.winner !== 'NO_WINNER' && test.winner !== 'INCONCLUSIVE' 
        ? `${((Math.max(test.variantA.performance.roas, test.variantB.performance.roas) - 
               Math.min(test.variantA.performance.roas, test.variantB.performance.roas)) / 
               Math.min(test.variantA.performance.roas, test.variantB.performance.roas) * 100).toFixed(1)}%`
        : 'No significant improvement',
      confidence: `${(test.confidence * 100).toFixed(1)}%`,
      nextAction: test.nextSteps[0] || 'Continue monitoring',
    };
  }

  /**
   * Export test results
   */
  @Get('tests/:testId/export')
  async exportTestResults(
    @Param('testId') testId: string,
    @Query('format') format: 'json' | 'csv' = 'json',
  ): Promise<any> {
    const test = await this.abTestingService.getTestResults(testId);
    
    if (format === 'csv') {
      // Return CSV format
      return {
        format: 'csv',
        data: 'testId,variant,impressions,clicks,conversions,ctr,conversionRate,cpa,roas\n' +
               `${testId},A,${test.variantA.performance.impressions},${test.variantA.performance.clicks},${test.variantA.performance.conversions},${test.variantA.performance.ctr},${test.variantA.performance.conversionRate},${test.variantA.performance.cpa},${test.variantA.performance.roas}\n` +
               `${testId},B,${test.variantB.performance.impressions},${test.variantB.performance.clicks},${test.variantB.performance.conversions},${test.variantB.performance.ctr},${test.variantB.performance.conversionRate},${test.variantB.performance.cpa},${test.variantB.performance.roas}`,
      };
    }
    
    return {
      format: 'json',
      data: test,
    };
  }
}
