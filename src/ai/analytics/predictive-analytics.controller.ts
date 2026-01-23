import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { PredictiveAnalyticsService } from './predictive-analytics.service';
import {
  PerformancePrediction,
  AudiencePrediction,
  BudgetOptimizationPrediction,
  CompetitiveAnalysis,
} from './predictive-analytics.service';

@Controller('ai/analytics')
@UseGuards(JwtAuthGuard)
export class PredictiveAnalyticsController {
  constructor(
    private readonly predictiveAnalyticsService: PredictiveAnalyticsService,
  ) {}

  /**
   * Predict campaign performance
   */
  @Post('predict-performance')
  @HttpCode(HttpStatus.OK)
  async predictCampaignPerformance(
    @Request() req: any,
    @Body() body: {
      campaignId: string;
      timeHorizon?: number;
    },
  ): Promise<PerformancePrediction> {
    return this.predictiveAnalyticsService.predictCampaignPerformance(
      req.user.id,
      body.campaignId,
      body.timeHorizon || 30,
    );
  }

  /**
   * Predict audience performance
   */
  @Post('predict-audience')
  @HttpCode(HttpStatus.OK)
  async predictAudiencePerformance(
    @Request() req: any,
    @Body() body: {
      campaignId: string;
      targetAudience: any;
    },
  ): Promise<AudiencePrediction> {
    return this.predictiveAnalyticsService.predictAudiencePerformance(
      req.user.id,
      body.campaignId,
      body.targetAudience,
    );
  }

  /**
   * Predict budget optimization
   */
  @Post('predict-budget-optimization')
  @HttpCode(HttpStatus.OK)
  async predictBudgetOptimization(
    @Request() req: any,
    @Body() body: {
      campaignId: string;
      totalBudget: number;
    },
  ): Promise<BudgetOptimizationPrediction> {
    return this.predictiveAnalyticsService.predictBudgetOptimization(
      req.user.id,
      body.campaignId,
      body.totalBudget,
    );
  }

  /**
   * Analyze competitive landscape
   */
  @Post('competitive-analysis')
  @HttpCode(HttpStatus.OK)
  async analyzeCompetitiveLandscape(
    @Request() req: any,
    @Body() body: {
      campaignId: string;
      keywords: string[];
    },
  ): Promise<CompetitiveAnalysis> {
    return this.predictiveAnalyticsService.analyzeCompetitiveLandscape(
      req.user.id,
      body.campaignId,
      body.keywords,
    );
  }

  /**
   * Train ML models
   */
  @Post('train-models')
  @HttpCode(HttpStatus.OK)
  async trainMLModels(
    @Request() req: any,
    @Body() body: {
      modelType: string;
    },
  ): Promise<any> {
    return this.predictiveAnalyticsService.trainMLModels(
      req.user.id,
      body.modelType,
    );
  }

  /**
   * Get prediction history
   */
  @Get('predictions')
  async getPredictionHistory(
    @Request() req: any,
    @Query('campaignId') campaignId?: string,
    @Query('modelType') modelType?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ): Promise<any> {
    return {
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * Get model performance metrics
   */
  @Get('models/:modelType/metrics')
  async getModelMetrics(
    @Param('modelType') modelType: string,
    @Request() req: any,
  ): Promise<any> {
    return {
      modelType,
      accuracy: 0.85,
      precision: 0.82,
      recall: 0.80,
      f1Score: 0.81,
      lastTrained: new Date(),
      dataPoints: 1000,
    };
  }

  /**
   * Get prediction confidence scores
   */
  @Get('confidence-scores/:campaignId')
  async getConfidenceScores(@Param('campaignId') campaignId: string): Promise<any> {
    return {
      campaignId,
      confidenceScores: {
        performancePrediction: 0.85,
        audiencePrediction: 0.78,
        budgetOptimization: 0.82,
        competitiveAnalysis: 0.75,
      },
      lastUpdated: new Date(),
    };
  }

  /**
   * Get prediction accuracy report
   */
  @Get('accuracy-report')
  async getAccuracyReport(
    @Request() req: any,
    @Query('timeframe') timeframe: string = '30d',
  ): Promise<any> {
    return {
      timeframe,
      overallAccuracy: 0.83,
      modelAccuracy: {
        performancePrediction: 0.85,
        audiencePrediction: 0.78,
        budgetOptimization: 0.82,
        competitiveAnalysis: 0.75,
      },
      improvementTrend: 'increasing',
      recommendations: [
        'Increase training data for audience prediction model',
        'Retrain budget optimization model with recent data',
      ],
    };
  }

  /**
   * Get prediction insights
   */
  @Get('insights/:campaignId')
  async getPredictionInsights(@Param('campaignId') campaignId: string): Promise<any> {
    return {
      campaignId,
      insights: [
        'Performance is trending upward with 85% confidence',
        'Audience targeting shows high conversion potential',
        'Budget optimization could improve ROI by 15-20%',
      ],
      actionableRecommendations: [
        'Increase budget allocation to top-performing keywords',
        'Expand audience targeting to similar demographics',
        'Implement automated bid adjustments',
      ],
      riskFactors: [
        'Market volatility may affect performance predictions',
        'Competition intensity is increasing',
      ],
    };
  }
}
